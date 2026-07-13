import katex from 'katex';
import { useMemo } from 'react';

interface Props {
  latex: string;
  /** Plain-English description for screen readers. */
  srText?: string;
}

export function MathView({ latex, srText }: Props) {
  const html = useMemo(() => {
    try {
      return katex.renderToString(latex, {
        displayMode: true,
        throwOnError: false,
        output: 'htmlAndMathml',
      });
    } catch {
      return '';
    }
  }, [latex]);

  return (
    <div
      className="math-view"
      role="img"
      aria-label={srText ?? latex}
      // eslint-disable-next-line react/no-danger
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
