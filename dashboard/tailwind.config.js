/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          DEFAULT: '#25D366',
          light: '#DCF8C6',
          dark: '#128C7E',
          darker: '#075E54',
        },
      },
    },
  },
  plugins: [],
};
