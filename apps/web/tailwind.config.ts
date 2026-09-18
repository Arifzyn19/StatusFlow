/** @type {import('tailwindcss').Config} */
export default {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}', './lib/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Premium dark system: near-black bg, charcoal surfaces, neutral borders
        ink: {
          950: '#0A0B0D',
          900: '#101214',
          850: '#15181B',
          800: '#1B1F23',
          700: '#262C31',
        },
        line: '#262C31',
        fog: '#9AA3AB',
        accent: {
          DEFAULT: '#3FA46A',
          dim: '#2C7A4E',
          soft: '#173626',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
      borderRadius: {
        sm: '6px',
        md: '8px',
        lg: '12px',
      },
    },
  },
  plugins: [],
};
