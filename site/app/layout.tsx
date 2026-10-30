/** LedgerAlpha document shell and metadata. Hosted authentication is supplied by Sites dispatch. */
import type { Metadata } from 'next';
import './globals.css';
export const metadata:Metadata={title:'LedgerAlpha · Private portfolio ledger',description:'Know what you own, who owns it, and how your decisions performed.',icons:{icon:'/favicon.svg'}};
/** Render the accessible application document. */
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="en"><body>{children}</body></html>;}
