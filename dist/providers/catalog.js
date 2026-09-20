export const PROVIDER_PROTOCOLS = ['openai', 'anthropic'];
/** IDs reserved by the runtimes that ship with the CLI (see createDefaultRegistry). */
export const RESERVED_PROVIDER_IDS = ['claude', 'opencode', 'codex', 'mock'];
export const providerPresets = [
    {
        id: 'anthropic',
        name: 'Anthropic',
        protocol: 'anthropic',
        baseUrl: 'https://api.anthropic.com',
        apiKeyEnv: 'ANTHROPIC_API_KEY',
        models: ['claude-sonnet-4-5', 'claude-opus-4-1', 'claude-3-7-sonnet-latest'],
    },
    {
        id: 'openai',
        name: 'OpenAI',
        protocol: 'openai',
        baseUrl: 'https://api.openai.com/v1',
        apiKeyEnv: 'OPENAI_API_KEY',
        models: ['gpt-4.1', 'gpt-4.1-mini', 'gpt-4o', 'gpt-4o-mini'],
    },
    {
        id: 'gemini',
        name: 'Google Gemini',
        protocol: 'openai',
        baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
        apiKeyEnv: 'GEMINI_API_KEY',
        models: ['gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.0-flash'],
    },
    {
        id: 'openrouter',
        name: 'OpenRouter',
        protocol: 'openai',
        baseUrl: 'https://openrouter.ai/api/v1',
        apiKeyEnv: 'OPENROUTER_API_KEY',
        models: [
            'deepseek/deepseek-chat-v3-0324:free',
            'meta-llama/llama-3.3-70b-instruct:free',
            'google/gemini-2.0-flash-exp:free',
            'anthropic/claude-sonnet-4',
        ],
        freeModels: [
            'deepseek/deepseek-chat-v3-0324:free',
            'meta-llama/llama-3.3-70b-instruct:free',
            'google/gemini-2.0-flash-exp:free',
        ],
    },
    {
        id: 'groq',
        name: 'Groq',
        protocol: 'openai',
        baseUrl: 'https://api.groq.com/openai/v1',
        apiKeyEnv: 'GROQ_API_KEY',
        models: ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant'],
    },
    {
        id: 'mistral',
        name: 'Mistral AI',
        protocol: 'openai',
        baseUrl: 'https://api.mistral.ai/v1',
        apiKeyEnv: 'MISTRAL_API_KEY',
        models: ['mistral-large-latest', 'mistral-small-latest', 'open-mistral-nemo'],
    },
    {
        id: 'deepseek',
        name: 'DeepSeek',
        protocol: 'openai',
        baseUrl: 'https://api.deepseek.com/v1',
        apiKeyEnv: 'DEEPSEEK_API_KEY',
        models: ['deepseek-chat', 'deepseek-reasoner'],
    },
    {
        id: 'xai',
        name: 'xAI',
        protocol: 'openai',
        baseUrl: 'https://api.x.ai/v1',
        apiKeyEnv: 'XAI_API_KEY',
        models: ['grok-3', 'grok-3-mini', 'grok-2-1212'],
    },
];
export function findPreset(id) {
    return providerPresets.find((preset) => preset.id === id);
}
export function isProviderProtocol(value) {
    return PROVIDER_PROTOCOLS.includes(value);
}
