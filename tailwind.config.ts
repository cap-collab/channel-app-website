import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      keyframes: {
        'heart-nudge': {
          '0%, 100%': { transform: 'scale(1)' },
          '30%': { transform: 'scale(1.3)' },
          '60%': { transform: 'scale(0.92)' },
          '80%': { transform: 'scale(1.12)' },
        },
      },
      animation: {
        'heart-nudge': 'heart-nudge 0.8s ease-out 2s 1',
      },
      fontFamily: {
        sans: ['var(--font-geist-sans)', '-apple-system', 'BlinkMacSystemFont', 'sans-serif'],
        mono: ['var(--font-geist-mono)', 'ui-monospace', 'monospace'],
      },
      colors: {
        background: "var(--background)",
        foreground: "var(--foreground)",
        // Channel brand colors
        accent: {
          DEFAULT: '#DC9B50',
          hover: '#E5AB66',
          muted: '#DC9B50/20',
        },
        surface: {
          base: '#121212',
          card: '#1C1C1C',
          elevated: '#262626',
        },
      },
    },
  },
  plugins: [],
};
export default config;
