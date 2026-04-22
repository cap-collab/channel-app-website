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
          '0%, 3%': { transform: 'scale(1)' },
          '1%': { transform: 'scale(1.3)' },
          '2%': { transform: 'scale(0.9)' },
          '2.5%': { transform: 'scale(1.15)' },
        },
        'heart-nudge-strong': {
          '0%, 6%': { transform: 'scale(1)' },
          '2%': { transform: 'scale(1.56)' },
          '4%': { transform: 'scale(0.72)' },
          '5%': { transform: 'scale(1.38)' },
        },
      },
      animation: {
        'heart-nudge': 'heart-nudge 20s ease-in-out 10s 3',
        'heart-nudge-strong': 'heart-nudge-strong 20s ease-in-out 2s 6',
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
          DEFAULT: '#D94099',
          hover: '#E54DA6',
          muted: '#D94099/20',
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
