import { Anton, Bebas_Neue, Montserrat, Permanent_Marker, Playfair_Display, Poppins } from 'next/font/google';
import type { FontId } from './types';

const montserrat = Montserrat({ subsets: ['latin'], variable: '--font-montserrat' });
const anton = Anton({ weight: '400', subsets: ['latin'], variable: '--font-anton' });
const bebas = Bebas_Neue({ weight: '400', subsets: ['latin'], variable: '--font-bebas' });
const poppins = Poppins({ weight: ['400', '600', '700', '800', '900'], subsets: ['latin'], variable: '--font-poppins' });
const playfair = Playfair_Display({ subsets: ['latin'], variable: '--font-playfair' });
const marker = Permanent_Marker({ weight: '400', subsets: ['latin'], variable: '--font-marker' });

export const FONTS: Record<FontId, { label: string; family: string; weight: number }> = {
  montserrat: { label: 'Montserrat', family: montserrat.style.fontFamily, weight: 800 },
  anton: { label: 'Anton', family: anton.style.fontFamily, weight: 400 },
  bebas: { label: 'Bebas Neue', family: bebas.style.fontFamily, weight: 400 },
  poppins: { label: 'Poppins', family: poppins.style.fontFamily, weight: 700 },
  playfair: { label: 'Playfair', family: playfair.style.fontFamily, weight: 700 },
  marker: { label: 'Marker', family: marker.style.fontFamily, weight: 400 },
};

export const fontVariables = [montserrat, anton, bebas, poppins, playfair, marker].map((f) => f.variable).join(' ');

/** Canvas text only uses a web font once it has loaded, so load every weight we draw with up front. */
export function loadFonts() {
  const specs = Object.values(FONTS).flatMap((f) => [`${f.weight} 40px ${f.family}`, `900 40px ${f.family}`, `600 40px ${f.family}`]);
  return Promise.all(specs.map((s) => document.fonts.load(s).catch(() => []))).then(() => undefined);
}
