/** The fixed neutral grey of a pill with no configured colour (docs/ui-github-look.md). */
const NEUTRAL = "ededed";

/**
 * GitHub's own label formula (docs/ui-github-look.md): the pill's CSS reads the channels, the hue and the
 * saturation and lightness (plain 0 to 100 numbers) from these inline custom properties, set from one hex colour.
 */
export function labelColorVars(hex: string | null): Record<string, string> {
  const clean = (hex ?? NEUTRAL).replace(/^#/, "");
  const value = /^[0-9a-f]{6}$/i.test(clean) ? clean : NEUTRAL;
  const [r, g, b] = [0, 2, 4].map((at) => parseInt(value.slice(at, at + 2), 16)) as [
    number,
    number,
    number,
  ];
  const max = Math.max(r, g, b) / 255;
  const min = Math.min(r, g, b) / 255;
  const lightness = (max + min) / 2;
  const delta = max - min;
  let hue = 0;
  let saturation = 0;
  if (delta !== 0) {
    saturation = delta / (1 - Math.abs(2 * lightness - 1));
    if (max === r / 255) hue = ((g - b) / 255 / delta + 6) % 6;
    else if (max === g / 255) hue = (b - r) / 255 / delta + 2;
    else hue = (r - g) / 255 / delta + 4;
    hue *= 60;
  }
  return {
    "--label-r": String(r),
    "--label-g": String(g),
    "--label-b": String(b),
    "--label-h": hue.toFixed(1),
    "--label-s": (saturation * 100).toFixed(1),
    "--label-l": (lightness * 100).toFixed(1),
  };
}
