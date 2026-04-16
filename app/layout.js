import './globals.css';

export const metadata = {
  title: 'Romana — Tickets de Pesaje',
  description: 'Carga de tickets de pesaje para Chicureo Verde',
};

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
};

export default function RootLayout({ children }) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
