import { describe, it, expect } from 'vitest';
import {
  validateConfig,
  DEFAULT_CONFIG,
  expandEnv,
  expandEnvMap,
  type NanoConfig,
} from '../src/config.js';

describe('validateConfig', () => {
  describe('provider validation', () => {
    it('should accept valid ollama config', () => {
      const config: NanoConfig = {
        provider: {
          active: 'ollama',
          ollama: {
            baseURL: 'http://localhost:11434/api',
            model: 'qwen3.6:latest',
          },
        },
      };
      const errors = validateConfig(config);
      expect(errors).toHaveLength(0);
    });

    it('should accept valid llama.cpp config', () => {
      const config: NanoConfig = {
        provider: {
          active: 'llama.cpp',
          'llama.cpp': {
            baseURL: 'http://127.0.0.1:8080/v1',
            model: 'qwen3.6:latest',
          },
        },
      };
      const errors = validateConfig(config);
      expect(errors).toHaveLength(0);
    });

    it('should accept valid remote config', () => {
      const config: NanoConfig = {
        provider: {
          active: 'remote',
          remote: {
            baseURL: 'https://api.openai.com/v1',
            model: 'gpt-4o-mini',
            apiKey: 'test-key',
          },
        },
      };
      const errors = validateConfig(config);
      expect(errors).toHaveLength(0);
    });

    it('should reject invalid provider', () => {
      const config: NanoConfig = {
        provider: {
          active: 'invalid' as 'ollama' | 'llama.cpp' | 'remote',
        },
      };
      const errors = validateConfig(config);
      expect(errors).toHaveLength(1);
      expect(errors[0].field).toBe('provider.active');
    });

    it('should reject invalid ollama baseURL', () => {
      const config: NanoConfig = {
        provider: {
          ollama: {
            baseURL: 'not-a-valid-url',
          },
        },
      };
      const errors = validateConfig(config);
      expect(errors).toHaveLength(1);
      expect(errors[0].field).toBe('provider.ollama.baseURL');
    });
  });

  describe('model validation', () => {
    it('should reject non-string model', () => {
      const config: NanoConfig = {
        provider: {
          ollama: {
            model: 123 as unknown as string,
          },
        },
      };
      const errors = validateConfig(config);
      expect(errors).toHaveLength(1);
      expect(errors[0].field).toBe('provider.ollama.model');
    });
  });

  describe('apiKey validation', () => {
    it('should reject non-string apiKey', () => {
      const config: NanoConfig = {
        provider: {
          remote: {
            baseURL: 'https://api.openai.com/v1',
            model: 'gpt-4o-mini',
            apiKey: 123 as unknown as string,
          },
        },
      };
      const errors = validateConfig(config);
      expect(errors).toHaveLength(1);
      expect(errors[0].field).toBe('provider.remote.apiKey');
    });
  });

  describe('MCP servers validation', () => {
    it('should accept valid stdio MCP server', () => {
      const config: NanoConfig = {
        mcpServers: {
          filesystem: {
            command: 'npx',
            args: ['-y', '@modelcontextprotocol/server-filesystem', '.'],
          },
        },
      };
      const errors = validateConfig(config);
      expect(errors).toHaveLength(0);
    });

    it('should accept valid streamable-http MCP server', () => {
      const config: NanoConfig = {
        mcpServers: {
          remote: {
            type: 'streamable-http',
            url: 'https://mcp.example.com/docs',
          },
        },
      };
      const errors = validateConfig(config);
      expect(errors).toHaveLength(0);
    });

    it('should reject MCP server missing command', () => {
      const config: NanoConfig = {
        mcpServers: {
          bad: {
            command: '',
          },
        },
      };
      const errors = validateConfig(config);
      expect(errors).toHaveLength(1);
      expect(errors[0].field).toBe('mcpServers.bad.command');
    });
  });

  describe('security validation', () => {
    it('should reject non-array allowedCommands', () => {
      const config: NanoConfig = {
        security: {
          shell: {
            allowedCommands: 'not-an-array' as unknown as string[],
          },
        },
      };
      const errors = validateConfig(config);
      expect(errors).toHaveLength(1);
      expect(errors[0].field).toBe('security.shell.allowedCommands');
    });

    it('should reject non-array deniedCommands', () => {
      const config: NanoConfig = {
        security: {
          shell: {
            deniedCommands: 123 as unknown as string[],
          },
        },
      };
      const errors = validateConfig(config);
      expect(errors).toHaveLength(1);
      expect(errors[0].field).toBe('security.shell.deniedCommands');
    });
  });

  describe('empty config', () => {
    it('should accept empty config', () => {
      const errors = validateConfig({});
      expect(errors).toHaveLength(0);
    });
  });
});

describe('expandEnv', () => {
  it('substitutes a defined variable', () => {
    expect(expandEnv('Bearer ${TOKEN}', { TOKEN: 'abc' })).toBe('Bearer abc');
  });

  it('substitutes multiple variables in one string', () => {
    expect(expandEnv('${A}-${B}', { A: 'x', B: 'y' })).toBe('x-y');
  });

  it('leaves missing variables as the literal placeholder', () => {
    expect(expandEnv('Bearer ${MISSING}', {})).toBe('Bearer ${MISSING}');
  });

  it('is case-insensitive about the placeholder syntax markers but matches env names verbatim', () => {
    // Regex allows lowercase letters in the var name; match is verbatim against env keys.
    expect(expandEnv('${foo}', { foo: 'ok' })).toBe('ok');
    expect(expandEnv('${FOO}', { foo: 'ok' })).toBe('${FOO}');
  });

  it('handles strings with no placeholders unchanged', () => {
    expect(expandEnv('plain text', { TOKEN: 'abc' })).toBe('plain text');
  });
});

describe('expandEnvMap', () => {
  it('returns undefined when given undefined', () => {
    expect(expandEnvMap(undefined, { X: '1' })).toBeUndefined();
  });

  it('expands every value in the map', () => {
    const out = expandEnvMap(
      { Authorization: 'Bearer ${T}', 'X-Trace': 'static' },
      { T: 'abc' },
    );
    expect(out).toEqual({ Authorization: 'Bearer abc', 'X-Trace': 'static' });
  });

  it('preserves missing variables in values', () => {
    const out = expandEnvMap({ k: '${MISSING}' }, {});
    expect(out).toEqual({ k: '${MISSING}' });
  });
});

describe('DEFAULT_CONFIG', () => {
  it('should have valid default provider', () => {
    expect(DEFAULT_CONFIG.provider?.active).toBe('ollama');
  });

  it('should have default ollama config', () => {
    expect(DEFAULT_CONFIG.provider?.ollama?.baseURL).toBe('http://127.0.0.1:11434/api');
    expect(DEFAULT_CONFIG.provider?.ollama?.model).toBe('qwen3.6:latest');
  });

  it('should have default llama.cpp config', () => {
    expect(DEFAULT_CONFIG.provider?.['llama.cpp']?.baseURL).toBe('http://127.0.0.1:8080/v1');
  });

  it('should have default remote config', () => {
    expect(DEFAULT_CONFIG.provider?.remote?.baseURL).toBe('');
    expect(DEFAULT_CONFIG.provider?.remote?.model).toBe('');
  });
});