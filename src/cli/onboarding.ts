import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { createInterface } from 'node:readline';
import { getConfigPath, DEFAULT_CONFIG, type NanoConfig, type ProviderConfig } from '../config.js';

function makeInterface() {
  return createInterface({
    input: process.stdin,
    output: process.stdout,
  });
}

async function askQuestion(rl: ReturnType<typeof createInterface>, question: string, defaultValue?: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(question, (answer: string) => {
      resolve(answer.trim() || defaultValue || '');
    });
  });
}

async function runOnboarding(configPath: string): Promise<NanoConfig> {
  const rl = makeInterface();

  console.log('\n📦 Welcome to Bonfire!\n');
  console.log('Let\'s set up your configuration.\n');

  console.log('Available providers: ollama, llama.cpp');
  const provider = await askQuestion(rl, 'Which provider would you like to use? [ollama]: ') || 'ollama';

  let baseURL = '';
  let model = '';

  if (provider === 'ollama') {
    baseURL = await askQuestion(rl, 'Ollama base URL [http://127.0.0.1:11434/api]: ') || 'http://127.0.0.1:11434/api';
    model = await askQuestion(rl, 'Ollama model [qwen3.6:latest]: ') || 'qwen3.6:latest';
  } else {
    baseURL = await askQuestion(rl, 'llama.cpp base URL [http://127.0.0.1:8080/v1]: ') || 'http://127.0.0.1:8080/v1';
    model = await askQuestion(rl, 'llama.cpp model [unsloth/Qwen3.6-35B-A3B]: ') || 'unsloth/Qwen3.6-35B-A3B';
  }

  const ollamaConfig = {
  baseURL: 'http://127.0.0.1:11434/api',
  model: 'qwen3.6:latest',
};

const llamaCppConfig = {
  baseURL: 'http://127.0.0.1:8080/v1',
  model: 'unsloth/Qwen3.6-35B-A3B',
};

const config: NanoConfig = {
  provider: {
    active: provider as 'ollama' | 'llama.cpp',
    ollama: ollamaConfig,
    'llama.cpp': llamaCppConfig,
  },
  mcpServers: {},
};

if (provider === 'ollama') {
  ollamaConfig.baseURL = baseURL;
  ollamaConfig.model = model;
} else {
  llamaCppConfig.baseURL = baseURL;
  llamaCppConfig.model = model;
}

rl.close();
return config;
}

export async function runOnboardingAndSave(): Promise<NanoConfig> {
  const configPath = getConfigPath();
  const config = await runOnboarding(configPath);
  
  const dir = dirname(configPath);
  await mkdir(dir, { recursive: true });
  await writeFile(configPath, JSON.stringify(config, null, 2) + '\n');

  console.log(`\n✅ Saved config to ${configPath}`);
  console.log('\nRun `bonfire` to start!\n');

  return config;
}

export async function checkAndRunOnboarding(): Promise<boolean> {
  const configPath = getConfigPath();

  try {
    await readFile(configPath, 'utf-8');
    return false;
  } catch {
    await runOnboardingAndSave();
    return true;
  }
}

export async function reconfigure(): Promise<NanoConfig> {
  const configPath = getConfigPath();
  let existingConfig: NanoConfig = DEFAULT_CONFIG;
  
  try {
    const raw = await readFile(configPath, 'utf-8');
    existingConfig = JSON.parse(raw) as NanoConfig;
  } catch {
    // Use defaults if no existing config
  }

  const rl = makeInterface();

  console.log('\n⚙️  Reconfigure Bonfire\n');
  console.log('Press Enter to keep current value in brackets.\n');

  const currentProvider = existingConfig.provider?.active || 'ollama';
  console.log(`Current: ${currentProvider}`);
  const provider = await askQuestion(rl, 'Provider [ollama/llama.cpp]: ') || currentProvider;

  let baseURL = '';
  let model = '';

  const currentOllama = existingConfig.provider?.ollama || DEFAULT_CONFIG.provider?.ollama!;
  const currentLlama = existingConfig.provider?.['llama.cpp'] || DEFAULT_CONFIG.provider?.['llama.cpp']!;

  if (provider === 'ollama') {
    console.log(`Current: ${currentOllama.baseURL} (${currentOllama.model})`);
    baseURL = await askQuestion(rl, 'Ollama base URL: ') || currentOllama.baseURL || '';
    model = await askQuestion(rl, 'Ollama model: ') || currentOllama.model || '';
  } else {
    console.log(`Current: ${currentLlama.baseURL} (${currentLlama.model})`);
    baseURL = await askQuestion(rl, 'llama.cpp base URL: ') || currentLlama.baseURL || '';
    model = await askQuestion(rl, 'llama.cpp model: ') || currentLlama.model || '';
  }

  const ollamaConfig2 = {
  baseURL: 'http://127.0.0.1:11434/api',
  model: 'qwen3.6:latest',
};

const llamaCppConfig2 = {
  baseURL: 'http://127.0.0.1:8080/v1',
  model: 'unsloth/Qwen3.6-35B-A3B',
};

const config: NanoConfig = {
  provider: {
    active: provider as 'ollama' | 'llama.cpp',
    ollama: ollamaConfig2,
    'llama.cpp': llamaCppConfig2,
  },
  mcpServers: existingConfig.mcpServers || {},
};

if (provider === 'ollama') {
  ollamaConfig2.baseURL = baseURL;
  ollamaConfig2.model = model;
} else {
  llamaCppConfig2.baseURL = baseURL;
  llamaCppConfig2.model = model;
}

const dir = dirname(configPath);
await mkdir(dir, { recursive: true });
await writeFile(configPath, JSON.stringify(config, null, 2) + '\n');

  console.log(`\n✅ Updated config at ${configPath}\n`);

  rl.close();
  return config;
}