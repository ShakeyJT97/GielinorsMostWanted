/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        oak: { 950: '#1f140b', 900: '#2e1d10', 800: '#3e2715', 700: '#56371e', 600: '#6e4a2a', 500: '#8a6038' },
        parchment: { 50: '#f6ecd2', 100: '#efe0bb', 200: '#e4cf9f', 300: '#d4b97f', 400: '#bf9f60' },
        ink: { DEFAULT: '#2a1c11', soft: '#5b4630' },
        iron: '#3b3a39',
        brass: '#c99a2e',
        wax: { pvm: '#8e1f1f', skilling: '#3e6a2d', special: '#3b3778' },
      },
      fontFamily: {
        display: ['Rye', 'Georgia', 'serif'],
        serif: ['Alegreya', 'Georgia', 'serif'],
        sc: ['"Alegreya SC"', 'Georgia', 'serif'],
      },
    },
  },
  plugins: [],
};
