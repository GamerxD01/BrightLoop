import { useCallback, useRef, useState } from 'react';
import { toFieldErrors } from '@brightloop/shared';
import type { ZodTypeAny, z } from 'zod';
import { ApiError } from './api';
import { useToast } from '../components/Toast';

export type FieldErrors = Record<string, string>;

/** Runs the shared schema in the browser: the same rules and messages as the API. */
export function check<S extends ZodTypeAny>(
  schema: S,
  payload: unknown,
): { data: z.infer<S> } | { errors: FieldErrors } {
  const result = schema.safeParse(payload);
  return result.success ? { data: result.data } : { errors: toFieldErrors(result.error) };
}

/** Moves focus to the first field the server or the schema rejected. */
export function focusFirstInvalid(form: HTMLFormElement | null) {
  window.requestAnimationFrame(() => {
    form?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  });
}

/**
 * Submit flow for every form: validate with the shared schema, send, map
 * server field errors back onto fields, toast the outcome.
 */
export function useFormSubmit<S extends ZodTypeAny, R>(
  schema: S,
  send: (data: z.infer<S>) => Promise<R>,
  options: { success?: string; onDone?: (result: R) => void } = {},
) {
  const [errors, setErrors] = useState<FieldErrors>({});
  const [pending, setPending] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const toast = useToast();

  const submit = useCallback(
    async (payload: unknown) => {
      const checked = check(schema, payload);
      if ('errors' in checked) {
        setErrors(checked.errors);
        focusFirstInvalid(formRef.current);
        return;
      }
      setErrors({});
      setPending(true);
      try {
        const result = await send(checked.data);
        if (options.success) toast.show(options.success);
        options.onDone?.(result);
      } catch (err) {
        if (err instanceof ApiError) {
          if (Object.keys(err.fieldErrors).length) {
            setErrors(err.fieldErrors);
            focusFirstInvalid(formRef.current);
          }
          toast.show(err.message, 'error');
        } else {
          toast.show('Something went wrong. Please try again.', 'error');
        }
      } finally {
        setPending(false);
      }
    },
    [schema, send, options, toast],
  );

  return { errors, setErrors, pending, submit, formRef };
}

/** Rupee text field value ("1,299.50") → paise for the schema. Empty becomes NaN so the schema reports it. */
export function rupeesToPaise(value: string): number {
  if (value.trim() === '') return Number.NaN;
  const n = Number(value.replace(/,/g, ''));
  return Number.isFinite(n) ? Math.round(n * 100) : Number.NaN;
}

export function paiseToRupeesInput(paise: number | null | undefined): string {
  if (paise === null || paise === undefined) return '';
  return (paise / 100).toFixed(2).replace(/\.00$/, '');
}

export function toInt(value: string): number {
  return value.trim() === '' ? Number.NaN : Number(value);
}
