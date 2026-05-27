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
          '0%, 100%': { transform: 'scale(1)',    filter: 'brightness(1)' },
          '25%':      { transform: 'scale(1.55)', filter: 'brightness(1.4)' },
          '55%':      { transform: 'scale(0.9)',  filter: 'brightness(1.1)' },
          '80%':      { transform: 'scale(1.2)',  filter: 'brightness(1.25)' },
        },
        'live-pulse': {
          '0%':   { transform: 'scale(1)',   opacity: '0.9' },
          '70%':  { transform: 'scale(2.4)', opacity: '0.15' },
          '100%': { transform: 'scale(2.6)', opacity: '0' },
        },
      },
      animation: {
        'heart-nudge': 'heart-nudge 1.2s ease-out 2s 1',
        'live-pulse': 'live-pulse 1.1s cubic-bezier(0, 0, 0.2, 1) infinite',
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
