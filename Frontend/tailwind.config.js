/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        ink: {
          DEFAULT: '#0B0E14',
          surface: '#12161F',
          raised: '#171C27',
          border: 'rgba(232,234,240,0.07)',
        },
        copper: {
          50: '#FBEEE1',
          200: '#F0C79B',
          400: '#E0A468',
          DEFAULT: '#D98F4E',
          600: '#B96F32',
          800: '#7A4A1F',
        },
        ledger: {
          DEFAULT: '#3FC1B0',
          dim: '#2C8F82',
          glow: 'rgba(63,193,176,0.35)',
        },
        parchment: {
          DEFAULT: '#E8EAF0',
          muted: '#8891A6',
          faint: '#5B6478',
        },
        signal: {
          danger: '#E2624F',
          warn: '#E0B84E',
        },
      },
      fontFamily: {
        display: ['"Space Grotesk"', 'sans-serif'],
        body: ['"Inter"', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'monospace'],
      },
      borderRadius: {
        xl2: '1.25rem',
      },
      boxShadow: {
        glass: '0 8px 32px rgba(0,0,0,0.35)',
        glow: '0 0 0 1px rgba(63,193,176,0.25), 0 0 24px rgba(63,193,176,0.15)',
      },
      backgroundImage: {
        'grain': "radial-gradient(circle at 20% 20%, rgba(217,143,78,0.08), transparent 40%), radial-gradient(circle at 80% 0%, rgba(63,193,176,0.06), transparent 35%)",
      },
      keyframes: {
        fadeUp: {
          '0%': { opacity: 0, transform: 'translateY(12px)' },
          '100%': { opacity: 1, transform: 'translateY(0)' },
        },
        pulseRing: {
          '0%': { boxShadow: '0 0 0 0 rgba(63,193,176,0.4)' },
          '100%': { boxShadow: '0 0 0 10px rgba(63,193,176,0)' },
        },
      },
      animation: {
        fadeUp: 'fadeUp 0.5s ease-out both',
        pulseRing: 'pulseRing 1.6s ease-out infinite',
      },
    },
  },
  plugins: [],
}
