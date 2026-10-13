export type LogoStyle = 'a' | 'b' | 'c';

export function normalizeLogoStyle(value?: string): LogoStyle {
  const style = value?.trim().toLowerCase();
  return style === 'b' || style === 'c' ? style : 'a';
}

// NEXT_PUBLIC values are embedded at build time, keeping metadata and clients consistent.
export const logoStyle = normalizeLogoStyle(process.env.NEXT_PUBLIC_LOGO_STYLE);
export const brandPath = `/brand/${logoStyle}`;
