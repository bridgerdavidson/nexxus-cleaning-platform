/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./src/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  darkMode: ['class'],
  theme: {
    extend: {
      colors: {
        primary: {
          // legacy yellow ramp (PRESERVED, do not change)
          50: '#FFFBF0', 100: '#FEF5D9', 200: '#FDEAB3', 300: '#FBDD88',
          400: '#F9D05C', 500: '#F7C41E', 600: '#D9A718', 700: '#B88914',
          800: '#936D10', 900: '#6B4F0C',
          // redesign semantic (NEW, additive)
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        secondary: {
          // legacy slate ramp (PRESERVED, do not change)
          50: '#f8fafc', 100: '#f1f5f9', 200: '#e2e8f0', 300: '#cbd5e1',
          400: '#94a3b8', 500: '#64748b', 600: '#475569', 700: '#334155',
          800: '#1e293b', 900: '#0f172a',
          // redesign semantic (NEW, additive)
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        // success ramp stays unchanged (legacy green)
        success: {
          50: '#f0fdf4',
          100: '#dcfce7',
          200: '#bbf7d0',
          300: '#86efac',
          400: '#4ade80',
          500: '#22c55e',
          600: '#16a34a',
          700: '#15803d',
          800: '#166534',
          900: '#14532d',
        },

        // ---- redesign ramps (NEW) ----
        brand: {
          50: '#EFF4FF', 100: '#DCE6FF', 200: '#C0D2FF', 300: '#93AEFF',
          400: '#5C84FF', 500: '#2E62FF', 600: '#0150FC', 700: '#0140CC',
          800: '#0A2F95', 900: '#102A6E', 950: '#0A1A47',
        },
        sky: { 300: '#9CD0FD', 400: '#68B6FA', 500: '#3F9DF5' },
        warm: {
          50: '#F7F6F3', 100: '#EFEDE8', 200: '#E6E2DB', 300: '#D7D2C8',
          400: '#B2AB9D', 500: '#8B8475', 600: '#6B6459', 700: '#4E483F',
          800: '#322E28', 900: '#211E1A', 950: '#14120F',
        },
        // status ramps (icon/label always accompanies color)
        positive: { 50: '#E7F7EE', DEFAULT: '#1FAE63', 700: '#0F7042' }, // success (700 darkened for AA on -50 tint: 5.5:1)
        caution:  { 50: '#FEF3E2', DEFAULT: '#F59E0B', 700: '#9A6300' }, // warning (700 darkened for AA on -50 tint: 4.6:1)
        critical: { 50: '#FDECEC', DEFAULT: '#E5484D', 700: '#B42A2F' }, // danger
        info:     { 50: '#EAF4FE', DEFAULT: '#3F9DF5', 700: '#1E6FB8' }, // info/sky

        // ---- shadcn semantic keys (NEW) ----
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        popover: {
          DEFAULT: 'hsl(var(--popover))',
          foreground: 'hsl(var(--popover-foreground))',
        },
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        // legacy `sans` (Inter) stays; add the redesign family under a new key
        jakarta: ['var(--font-sans)', 'system-ui', 'sans-serif'],
      },
      borderRadius: {
        chip: '10px',     // sm
        control: '14px',  // md
        field: '18px',    // lg (inputs/selects)
        card: '22px',     // xl (cards)
        pill: '9999px',   // buttons / badges
      },
      boxShadow: {
        'soft-sm': '0 1px 2px rgb(var(--shadow-rgb) / 0.06)',
        'soft-md': '0 8px 24px rgb(var(--shadow-rgb) / 0.08), 0 2px 6px rgb(var(--shadow-rgb) / 0.05)',
        'soft-lg': '0 14px 34px rgb(var(--shadow-rgb) / 0.12), 0 4px 10px rgb(var(--shadow-rgb) / 0.06)',
      },
      transitionDuration: { fast: '150ms', base: '200ms', slow: '300ms' },
      transitionTimingFunction: { 'out-soft': 'cubic-bezier(0.16, 1, 0.3, 1)' },
      animation: {
        'fade-in': 'fadeIn 0.5s ease-in-out',
        'slide-up': 'slideUp 0.3s ease-out',
        'sheet-up': 'sheetUp 250ms cubic-bezier(0.32, 0.72, 0, 1)',
        'slide-in-right': 'slideInRight 250ms cubic-bezier(0.32, 0.72, 0, 1)',
        'slide-in-left': 'slideInLeft 250ms cubic-bezier(0.32, 0.72, 0, 1)',
        'bounce-gentle': 'bounceGentle 2s infinite',
        'toast-in': 'toast-in 0.3s ease-out forwards',
        'toast-out': 'toast-out 0.25s ease-in forwards',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        slideUp: {
          '0%': { transform: 'translateY(10px)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        },
        sheetUp: {
          '0%': { transform: 'translateY(100%)' },
          '100%': { transform: 'translateY(0)' },
        },
        slideInRight: {
          '0%': { transform: 'translateX(20px)', opacity: '0' },
          '100%': { transform: 'translateX(0)', opacity: '1' },
        },
        slideInLeft: {
          '0%': { transform: 'translateX(-20px)', opacity: '0' },
          '100%': { transform: 'translateX(0)', opacity: '1' },
        },
        bounceGentle: {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-5px)' },
        }
      }
    },
  },
  plugins: [
    require('@tailwindcss/forms'),
    require('@tailwindcss/typography'),
    require('tailwindcss-animate'),
  ],
};
