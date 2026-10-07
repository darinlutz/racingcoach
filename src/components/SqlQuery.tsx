'use client';

import { useState } from 'react';

type QueryResult = {
  command: string;
  columns: string[];
  rows: unknown[][];
  rowCount: number;
  truncated: boolean;
};

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

// Lays the rows out as an aligned plain-text table, like psql does
function formatResult(result: QueryResult): string {
  const { columns, rows, rowCount, truncated, command } = result;
  if (columns.length === 0) {
    return `${command} ${rowCount}`.trim();
  }
  const cells = rows.map((row) => row.map(formatValue));
  const widths = columns.map((name, i) => Math.max(name.length, ...cells.map((row) => row[i].length)));
  const line = (values: string[]) => values.map((v, i) => v.padEnd(widths[i])).join(' | ').trimEnd();
  const lines = [line(columns), widths.map((w) => '-'.repeat(w)).join('-+-'), ...cells.map(line)];
  lines.push('', `(${rowCount} row${rowCount === 1 ? '' : 's'}${truncated ? `, showing the first ${rows.length}` : ''})`);
  return lines.join('\n');
}

// The SQL box starts with this query, which lists the app's tables in the racingcoach schema
const STARTER_QUERY =
  'SELECT table_schema, table_name\n' +
  'FROM information_schema.tables\n' +
  "WHERE table_schema = 'racingcoach'\n" +
  'ORDER BY 1, 2;';

export default function SqlQuery() {
  const [sql, setSql] = useState(STARTER_QUERY);
  const [status, setStatus] = useState<'idle' | 'loading'>('idle');
  const [output, setOutput] = useState('');
  const [failed, setFailed] = useState(false);

  const runQuery = async () => {
    if (!sql.trim()) return;
    setStatus('loading');
    setOutput('');
    setFailed(false);

    try {
      const response = await fetch('/api/sql-query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sql }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Query failed');
      }
      setOutput(formatResult(data));
    } catch (error) {
      setFailed(true);
      setOutput(`ERROR: ${error instanceof Error ? error.message : 'Query failed'}`);
    } finally {
      setStatus('idle');
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <label htmlFor="sql-query" className="block text-sm font-medium text-dark-blue mb-2">
          SQL
        </label>
        <textarea
          id="sql-query"
          value={sql}
          onChange={(e) => setSql(e.target.value)}
          // Ctrl+Enter (Cmd+Enter on Mac) runs the query
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
              e.preventDefault();
              runQuery();
            }
          }}
          rows={6}
          spellCheck={false}
          className="w-full px-4 py-3 bg-white border border-slate-300 rounded-lg text-dark-blue font-mono text-sm placeholder-slate-400 focus:outline-none focus:border-powder-600 focus:ring-1 focus:ring-powder-500 transition-colors"
        />
      </div>

      <button
        type="button"
        onClick={runQuery}
        disabled={!sql.trim() || status === 'loading'}
        className="px-6 py-3 bg-gradient-to-r from-powder-500 to-powder-600 text-white font-bold rounded-lg hover:shadow-lg hover:shadow-powder-500/50 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {status === 'loading' ? 'Running...' : 'Run Query'}
      </button>

      <div>
        <label htmlFor="sql-results" className="block text-sm font-medium text-dark-blue mb-2">
          Results
        </label>
        <textarea
          id="sql-results"
          value={output}
          readOnly
          rows={14}
          wrap="off"
          spellCheck={false}
          placeholder="Query results appear here."
          className={`w-full px-4 py-3 bg-white border rounded-lg font-mono text-sm placeholder-slate-400 focus:outline-none ${
            failed ? 'border-red-300 text-red-700' : 'border-slate-300 text-dark-blue'
          }`}
        />
        <p className="mt-2 text-xs text-slate-500">
          Queries are read-only and time out after 10 seconds. Run one statement at a time.
        </p>
      </div>
    </div>
  );
}
