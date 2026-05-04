import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import type { NanoConfig, ProviderId, RemoteProviderConfig, OllamaProviderConfig, LlamaCppProviderConfig } from '../../config.js';

interface ReconfigurePromptProps {
  existingConfig: NanoConfig;
  onComplete: (config: NanoConfig) => void;
  onCancel: () => void;
}

const PROVIDERS: ProviderId[] = ['ollama', 'llama.cpp', 'remote'];

interface HeaderEntry {
  key: string;
  value: string;
}

export function ReconfigurePrompt({ existingConfig, onComplete, onCancel }: ReconfigurePromptProps) {
  const [step, setStep] = useState(0);
  const [provider, setProvider] = useState<ProviderId>(existingConfig.provider?.active || 'ollama');
  const [baseURL, setBaseURL] = useState('');
  const [model, setModel] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [headers, setHeaders] = useState<HeaderEntry[]>(() => {
    const existing = existingConfig.provider?.remote?.headers;
    if (existing) {
      return Object.entries(existing).map(([key, value]) => ({ key, value }));
    }
    return [];
  });
  const [headerKey, setHeaderKey] = useState('');
  const [headerValue, setHeaderValue] = useState('');
  const [addingHeader, setAddingHeader] = useState(false);
  const [inputValue, setInputValue] = useState('');

  const isRemote = provider === 'remote';
  const totalSteps = isRemote ? 4 + headers.length + 1 : 3;

  const getStepLabel = (stepIndex: number): string => {
    if (stepIndex === 0) return 'Provider';
    if (isRemote) {
      if (stepIndex === 1) return 'Base URL';
      if (stepIndex === 2) return 'Model';
      if (stepIndex === 3) return 'API Key (optional)';
      if (stepIndex < totalSteps - 1) return `Header ${stepIndex - 3}`;
      return 'Done? (Enter)';
    }
    if (stepIndex === 1) return 'Base URL';
    return 'Model';
  };

  const getDefaultValue = (stepIndex: number): string => {
    if (stepIndex === 0) return provider;
    if (isRemote) {
      if (stepIndex === 1) return existingConfig.provider?.remote?.baseURL || 'https://api.openai.com/v1';
      if (stepIndex === 2) return existingConfig.provider?.remote?.model || 'gpt-4o-mini';
      if (stepIndex === 3) return existingConfig.provider?.remote?.apiKey || '';
      const headerIdx = stepIndex - 4;
      if (headerIdx < headers.length) return headers[headerIdx].key;
      return '';
    }
    if (provider === 'ollama') {
      const cfg = existingConfig.provider?.ollama as OllamaProviderConfig | undefined;
      if (stepIndex === 1) return cfg?.baseURL || 'http://127.0.0.1:11434/api';
      return cfg?.model || 'qwen3.6:latest';
    }
    const cfg = existingConfig.provider?.['llama.cpp'] as LlamaCppProviderConfig | undefined;
    if (stepIndex === 1) return cfg?.baseURL || 'http://127.0.0.1:8080/v1';
    return cfg?.model || 'unsloth/Qwen3.6-35B-A3B';
  };

  // Effective value if the user submits right now: typed text wins, else the
  // step's default. Used for save-time logic.
  const effectiveValue = addingHeader
    ? (step < 4 + headers.length ? headerKey : headerValue)
    : (inputValue.trim() || getDefaultValue(step));

  // Display split: what the user has typed (bold + cursor) and a default
  // placeholder shown dim when nothing has been typed yet. Keeping these
  // visually distinct prevents the "I thought I deleted ollama" confusion.
  const typedValue = addingHeader
    ? (step < 4 + headers.length ? headerKey : headerValue)
    : inputValue;
  const placeholderValue = addingHeader ? '' : getDefaultValue(step);

  useInput((ch, key) => {
    if (key.escape) {
      if (addingHeader) {
        setAddingHeader(false);
        setHeaderKey('');
        setHeaderValue('');
        return;
      }
      onCancel();
      return;
    }

    if (key.return) {
      const finalValue = effectiveValue;

      if (addingHeader) {
        if (!headerKey.trim()) {
          setAddingHeader(false);
          setHeaderKey('');
          setHeaderValue('');
          setStep(step + 1);
          return;
        }
        setHeaders([...headers, { key: headerKey.trim(), value: headerValue }]);
        setHeaderKey('');
        setHeaderValue('');
        setAddingHeader(false);
        return;
      }

      if (step === 0) {
        if (!PROVIDERS.includes(finalValue as ProviderId)) return;
        setProvider(finalValue as ProviderId);
        if (finalValue !== provider) {
          setBaseURL('');
          setModel('');
          setApiKey('');
          setHeaders([]);
        }
      } else if (step === 1) {
        setBaseURL(finalValue);
        // For ollama/llama.cpp this is not the final step — flow continues
        // to model. For remote there are still more steps after this.
      } else if (step === 2) {
        setModel(finalValue);
        // For ollama/llama.cpp, step 2 is the final step. React hasn't
        // flushed setModel yet, so pass the fresh value into buildConfig
        // explicitly instead of letting it read stale closure state.
        if (!isRemote) {
          onComplete(buildConfig({ model: finalValue }));
          return;
        }
      } else if (step === 3) {
        setApiKey(finalValue);
      } else if (step === totalSteps - 1) {
        // Remote-only "Done?" step. All previous setX calls have already
        // flushed across earlier renders, so closure state is current.
        onComplete(buildConfig());
        return;
      } else {
        const headerIdx = step - 4;
        if (headerIdx < headers.length) {
          const newHeaders = [...headers];
          newHeaders[headerIdx] = { key: headers[headerIdx].key, value: finalValue };
          setHeaders(newHeaders);
        }
      }

      setInputValue('');

      if (step < totalSteps - 1) {
        setStep(step + 1);
      } else {
        // Defensive fallback — every legitimate path above already returned.
        onComplete(buildConfig());
      }
      return;
    }

    if (key.backspace) {
      if (addingHeader) {
        if (headerValue) {
          setHeaderValue((prev) => prev.slice(0, -1));
        } else if (headerKey) {
          setHeaderKey((prev) => prev.slice(0, -1));
        }
        return;
      }
      setInputValue((prev) => prev.slice(0, -1));
      return;
    }

    if (ch) {
      if (addingHeader) {
        if (step < 4 + headers.length) {
          setHeaderKey((prev) => prev + ch);
        } else {
          setHeaderValue((prev) => prev + ch);
        }
        return;
      }
      setInputValue((prev) => prev + ch);
    }
  });

  /**
   * `overrides` carries any value just submitted via the latest Enter press —
   * React has not yet flushed the corresponding setState, so the closure
   * variables (`model`, `baseURL`, …) below are still stale for that one
   * field. Callers pass the fresh value here to bypass the stale read.
   */
  const buildConfig = (
    overrides: { baseURL?: string; model?: string; apiKey?: string } = {},
  ): NanoConfig => {
    const finalBaseURL = overrides.baseURL ?? baseURL;
    const finalModel = overrides.model ?? model;
    const finalApiKey = overrides.apiKey ?? apiKey;

    const baseProviders = {
      ollama: {
        baseURL: provider === 'ollama' ? finalBaseURL : (existingConfig.provider?.ollama?.baseURL || 'http://127.0.0.1:11434/api'),
        model: provider === 'ollama' ? finalModel : (existingConfig.provider?.ollama?.model || 'qwen3.6:latest'),
      },
      'llama.cpp': {
        baseURL: provider === 'llama.cpp' ? finalBaseURL : (existingConfig.provider?.['llama.cpp']?.baseURL || 'http://127.0.0.1:8080/v1'),
        model: provider === 'llama.cpp' ? finalModel : (existingConfig.provider?.['llama.cpp']?.model || 'unsloth/Qwen3.6-35B-A3B'),
      },
    };

    if (provider === 'remote') {
      const headerObj: Record<string, string> = {};
      headers.forEach((h) => {
        if (h.key && h.value) headerObj[h.key] = h.value;
      });

      return {
        provider: {
          ...baseProviders,
          active: 'remote',
          remote: {
            baseURL: finalBaseURL,
            model: finalModel,
            ...(finalApiKey ? { apiKey: finalApiKey } : {}),
            ...(Object.keys(headerObj).length > 0 ? { headers: headerObj } : {}),
          },
        },
        mcpServers: existingConfig.mcpServers || {},
      };
    }

    return {
      provider: {
        ...baseProviders,
        active: provider,
        remote: existingConfig.provider?.remote,
      },
      mcpServers: existingConfig.mcpServers || {},
    };
  };

  const isHeaderStep = isRemote && step >= 4 && step < 4 + headers.length;
  const isAddHeaderStep = isRemote && step === 4 + headers.length;
  const isDoneStep = isRemote && step === totalSteps - 1;

  return (
    <Box flexDirection="column" padding={1} borderStyle="round" borderColor="cyan">
      <Text bold color="cyan">⚙️  Configure Bonfire</Text>
      <Text dimColor>Step {step + 1}/{totalSteps} · Enter to continue · Esc to cancel</Text>
      
      <Box marginTop={1}>
        <Text>{getStepLabel(step)}: </Text>
        {typedValue ? (
          <Text>
            <Text bold>{typedValue}</Text>
            <Text inverse> </Text>
          </Text>
        ) : (
          <Text>
            <Text inverse> </Text>
            {placeholderValue ? <Text dimColor>{placeholderValue}</Text> : null}
          </Text>
        )}
      </Box>
      {!typedValue && placeholderValue ? (
        <Box>
          <Text dimColor>(Enter to accept the default shown above, or type to override)</Text>
        </Box>
      ) : null}
      
      {step === 0 && (
        <Box marginTop={1}>
          <Text dimColor>Options: {PROVIDERS.join(', ')}</Text>
        </Box>
      )}
      
      {isRemote && step >= 3 && (
        <Box marginTop={1}>
          <Text dimColor>Headers: {headers.length > 0 ? headers.map(h => `${h.key}=***`).join(', ') : 'none'}</Text>
        </Box>
      )}
      
      {isAddHeaderStep && (
        <Box marginTop={1}>
          <Text dimColor>Type header name, Enter, then value. Enter on empty to skip.</Text>
        </Box>
      )}
      
      {isDoneStep && (
        <Box marginTop={1}>
          <Text dimColor>Press Enter to save, Esc to cancel</Text>
        </Box>
      )}
    </Box>
  );
}
