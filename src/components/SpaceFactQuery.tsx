'use client';

import { useEffect, useState } from 'react';

const LLM_OPTIONS = [
  { value: 'openai', label: 'OpenAI (gpt-4o-mini)', needsOllama: false },
  { value: 'ollama', label: 'Ollama (llama3.2)', needsOllama: true },
];

const EMBEDDING_OPTIONS = [
  { value: 'openai', label: 'OpenAI Embeddings', needsOllama: false },
  { value: 'chroma', label: 'Chroma Default', needsOllama: false },
  { value: 'nomic', label: 'Nomic Embed Text (Ollama)', needsOllama: true },
];

interface SpaceFactQueryProps {
  endpoint?: string;
  queryLabel?: string;
  placeholder?: string;
}

export default function SpaceFactQuery({
  endpoint = '/api/space-fact-query',
  queryLabel = 'Ask a Question About Space',
  placeholder = 'e.g., What is the Hubble Space Telescope?',
}: SpaceFactQueryProps) {
  const [ollamaAvailable, setOllamaAvailable] = useState(false);
  const [llmType, setLlmType] = useState('openai');
  const [embeddingType, setEmbeddingType] = useState('openai');
  const [query, setQuery] = useState('');
  const [response, setResponse] = useState('');
  const [references, setReferences] = useState<string[]>([]);
  const [status, setStatus] = useState<'idle' | 'loading' | 'error'>('idle');
  const [message, setMessage] = useState('');

  // Ollama options only appear when the server can reach a local Ollama.
  useEffect(() => {
    fetch(endpoint)
      .then((res) => res.json())
      .then((data) => setOllamaAvailable(Boolean(data.ollamaAvailable)))
      .catch(() => setOllamaAvailable(false));
  }, [endpoint]);

  const llmOptions = LLM_OPTIONS.filter((option) => ollamaAvailable || !option.needsOllama);
  const embeddingOptions = EMBEDDING_OPTIONS.filter(
    (option) => ollamaAvailable || !option.needsOllama
  );

  const handleAsk = async () => {
    if (!query.trim()) return;

    setStatus('loading');
    setMessage('');

    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ query, llmType, embeddingType }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Failed to query space facts');
      }

      setResponse(data.response);
      setReferences(data.references ?? []);
      setStatus('idle');
    } catch (error) {
      setStatus('error');
      setMessage(error instanceof Error ? error.message : 'Failed to query space facts');
    }
  };

  return (
    <div className="bg-secondary rounded-xl border border-border p-8">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 mb-6">
        <fieldset>
          <legend className="block text-sm font-medium text-foreground mb-2">LLM Model</legend>
          <div className="space-y-2">
            {llmOptions.map((option) => (
              <label key={option.value} className="flex items-center gap-2 text-foreground text-sm">
                <input
                  type="radio"
                  name="space-fact-llm"
                  value={option.value}
                  checked={llmType === option.value}
                  onChange={() => setLlmType(option.value)}
                  disabled={status === 'loading'}
                  className="accent-primary"
                />
                {option.label}
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset>
          <legend className="block text-sm font-medium text-foreground mb-2">Embedding Model</legend>
          <div className="space-y-2">
            {embeddingOptions.map((option) => (
              <label key={option.value} className="flex items-center gap-2 text-foreground text-sm">
                <input
                  type="radio"
                  name="space-fact-embedding"
                  value={option.value}
                  checked={embeddingType === option.value}
                  onChange={() => setEmbeddingType(option.value)}
                  disabled={status === 'loading'}
                  className="accent-primary"
                />
                {option.label}
              </label>
            ))}
          </div>
        </fieldset>
      </div>

      <label htmlFor="space-fact-query" className="block text-sm font-medium text-foreground mb-2">
        {queryLabel}
      </label>
      <textarea
        id="space-fact-query"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={placeholder}
        rows={3}
        className="w-full px-4 py-3 bg-card border border-border rounded-lg text-foreground placeholder-muted-foreground focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-colors resize-none"
      />

      <button
        type="button"
        onClick={handleAsk}
        disabled={status === 'loading' || !query.trim()}
        className="mt-4 w-full px-4 py-2 bg-gradient-to-r from-primary to-primary-strong text-white font-bold rounded-lg hover:shadow-lg hover:shadow-primary/40 transition-all disabled:opacity-50 disabled:cursor-not-allowed transform hover:scale-105 disabled:hover:scale-100"
      >
        {status === 'loading' ? (
          <span className="flex items-center justify-center gap-2">
            <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></span>
            Asking...
          </span>
        ) : (
          'Ask'
        )}
      </button>

      {message && (
        <div className="mt-4 p-4 rounded-lg bg-primary/15 border border-primary/40 text-red-300">
          {message}
        </div>
      )}

      {response && (
        <div className="mt-6">
          <h3 className="text-sm font-medium text-foreground mb-2">Response</h3>
          <div className="p-4 rounded-lg bg-card border border-border text-foreground whitespace-pre-wrap leading-relaxed">
            {response}
          </div>
        </div>
      )}

      {references.length > 0 && (
        <div className="mt-6">
          <h3 className="text-sm font-medium text-foreground mb-2">References Used</h3>
          <ul className="space-y-2">
            {references.map((ref, index) => (
              <li
                key={index}
                className="p-3 rounded-lg bg-card border border-border text-foreground text-sm"
              >
                {ref}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
