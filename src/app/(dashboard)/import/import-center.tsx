'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useRef, useState } from 'react';
import { Button, TextInput } from '@/components/ui/controls';
import { Card, CardHeader, cx } from '@/components/ui/primitives';
import { ImportPreview } from './import-preview';
import { ImportProgress, STAGES, type Stage } from './import-progress';
import type { ConfirmPayload, PreviewResponse } from './types';

/**
 * The upload workflow.
 *
 * Upload → parse → preview → confirm. The preview step exists so a wrong
 * project or report type is corrected BEFORE anything reaches the financial
 * tables (requirement 14).
 */
export function ImportCenter() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);

  const [dragging, setDragging] = useState(false);
  const [stage, setStage] = useState<Stage | null>(null);
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reportDate, setReportDate] = useState('');

  const upload = useCallback(
    async (files: FileList | File[]) => {
      const list = Array.from(files);
      if (list.length === 0) return;

      setError(null);
      setPreview(null);
      setStage('uploading');

      const form = new FormData();
      for (const file of list) form.append('files', file);
      if (reportDate) form.append('reportDate', reportDate);

      try {
        // The server runs read → detect → map → calculate as one request; the
        // stages shown here track that sequence rather than polling for it.
        setStage('reading_workbook');
        const response = await fetch('/api/import/upload', { method: 'POST', body: form });

        setStage('detecting_sheets');
        const data = await response.json();

        if (!response.ok) {
          setError(data.error ?? 'The upload failed.');
          setStage(null);
          return;
        }

        setStage('mapping_data');
        setPreview(data as PreviewResponse);
        setReportDate((data as PreviewResponse).reportDate);
        setStage('completed');
      } catch (err) {
        setError(`The upload failed: ${(err as Error).message}`);
        setStage(null);
      }
    },
    [reportDate],
  );

  const onDrop = (event: React.DragEvent) => {
    event.preventDefault();
    setDragging(false);
    if (event.dataTransfer.files.length > 0) void upload(event.dataTransfer.files);
  };

  const confirm = async (payload: ConfirmPayload) => {
    if (!preview) return;
    setStage('calculating');
    setError(null);

    try {
      const response = await fetch('/api/import/confirm', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          previewId: preview.previewId,
          reportDate,
          label: payload.label,
          mode: payload.mode,
          overrides: payload.overrides,
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        setError(data.error ?? 'The import failed.');
        setStage(null);
        return;
      }

      setStage('completed');
      setPreview(null);
      router.push('/');
      router.refresh();
    } catch (err) {
      setError(`The import failed: ${(err as Error).message}`);
      setStage(null);
    }
  };

  const busy = stage !== null && stage !== 'completed';

  return (
    <>
      <Card>
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          className={cx(
            'flex flex-col items-center justify-center rounded-[var(--radius-card)] border-2 border-dashed px-6 py-14 text-center transition-colors',
            dragging ? 'border-accent bg-accent-soft' : 'border-border-strong',
          )}
        >
          <p className="text-base font-medium text-ink">Upload Financial Excel Files</p>
          <p className="mt-1 text-sm text-ink-secondary">
            Drag and drop here, or choose files. Excel (.xlsx, .xls) and ZIP archives containing
            several workbooks are supported.
          </p>

          <input
            ref={inputRef}
            type="file"
            multiple
            accept=".xlsx,.xls,.xlsm,.xlsb,.csv,.zip"
            className="hidden"
            onChange={(e) => e.target.files && void upload(e.target.files)}
          />

          <div className="mt-5 flex flex-wrap items-end justify-center gap-3">
            <Button variant="primary" onClick={() => inputRef.current?.click()} disabled={busy}>
              Choose files
            </Button>
            <TextInput
              label="Report date (optional)"
              type="date"
              value={reportDate}
              onChange={(e) => setReportDate(e.target.value)}
            />
          </div>

          <p className="mt-3 text-xs text-ink-muted">
            Leave the date blank to let the importer read it from the files themselves.
          </p>
        </div>

        {stage ? (
          <div className="mt-5">
            <ImportProgress current={stage} />
          </div>
        ) : null}

        {error ? (
          <p className="mt-4 rounded-md border border-critical/30 bg-critical/10 px-3 py-2 text-sm text-critical">
            {error}
          </p>
        ) : null}
      </Card>

      {preview ? (
        <div className="mt-4">
          <ImportPreview
            preview={preview}
            reportDate={reportDate}
            onReportDateChange={setReportDate}
            onConfirm={confirm}
            onCancel={() => setPreview(null)}
            busy={busy}
          />
        </div>
      ) : null}

      {!preview && !stage ? (
        <div className="mt-4">
          <Card>
            <CardHeader
              title="What happens when you upload"
              subtitle="Nothing is saved until you confirm"
            />
            <ol className="space-y-1.5 text-sm text-ink-secondary">
              {STAGES.map((s, index) => (
                <li key={s.key} className="flex gap-2">
                  <span className="tnum w-5 shrink-0 text-ink-muted">{index + 1}.</span>
                  <span>
                    <span className="font-medium text-ink">{s.label}</span> — {s.detail}
                  </span>
                </li>
              ))}
            </ol>
          </Card>
        </div>
      ) : null}
    </>
  );
}
