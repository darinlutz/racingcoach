import BitcoinTicker from '@/components/BitcoinTicker';
import OilTicker from '@/components/OilTicker';
import TreasuryTicker from '@/components/TreasuryTicker';
import YenTicker from '@/components/YenTicker';
import GoldTicker from '@/components/GoldTicker';
import Link from 'next/link';

export default function Home() {
  return (
    <div className="w-full">
      {/* Market Tickers Section */}
      <section className="min-h-[40vh] pt-10 pb-5 bg-gradient-to-b from-white via-slate-50 to-slate-100 flex items-center justify-center px-2 sm:px-3 lg:px-4 relative overflow-hidden">
        <div className="absolute inset-0 overflow-hidden">
          <div className="absolute top-0 right-0 w-96 h-96 bg-powder-500/5 rounded-full blur-3xl"></div>
          <div className="absolute bottom-0 left-0 w-96 h-96 bg-powder-600/5 rounded-full blur-3xl"></div>
        </div>
        <div className="relative z-10 w-full max-w-7xl mx-auto grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 items-center justify-center gap-6">
          <BitcoinTicker />
          <OilTicker />
          <TreasuryTicker />
          <YenTicker />
          <GoldTicker />
        </div>
      </section>

      {/* Hero Section */}
      <section className="py-6 bg-gradient-to-b from-slate-100 to-white flex items-center justify-center px-2 sm:px-3 lg:px-4">
        <div className="max-w-4xl mx-auto text-center">
          {/* Company Name */}
          <h1 className="text-5xl sm:text-6xl md:text-7xl font-bold mb-6">
            <span className="bg-gradient-to-r from-powder-600 via-powder-500 to-powder-600 bg-clip-text">
              Clarivex
            </span>
          </h1>

          {/* Tagline */}
          <p className="text-xl sm:text-2xl md:text-3xl text-dark-blue font-light mb-8 leading-relaxed">
            Tackling complex problems with <span className="text-powder-600 font-semibold">clear solutions</span>
          </p>

          {/* Description */}
          <p className="text-base sm:text-lg text-slate-600 mb-10 max-w-2xl mx-auto leading-relaxed">
            We specialize in helping businesses automate and streamline their repetitive processes.
            From data analytics to system integration, we deliver clarity and efficiency at every step.
          </p>

          {/* CTA Buttons */}
          <div className="flex flex-col sm:flex-row gap-4 justify-center mb-12">
            <Link
              href="/signup"
              className="px-4 py-2 bg-gradient-to-r from-powder-500 to-powder-600 text-white font-bold rounded-lg hover:shadow-lg
              hover:shadow-powder-500/50 transition-all transform hover:scale-105"
            >
              Get Started Now
            </Link>
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section className="py-8 px-2 sm:px-3 lg:px-4 bg-white border-t border-slate-200 flex flex-col items-center">
        <div className="w-full max-w-6xl">
          <h2 className="text-3xl md:text-4xl font-bold text-center mb-12 text-red-600">
            Why Choose Clarivex?
          </h2>

        <br />

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 justify-items-center">
            {/* Feature 1 */}
            <div className="bg-slate-50 rounded-lg py-5 px-6 border border-slate-200 hover:border-powder-300 transition-all transform hover:-translate-y-2">
              <div className="w-12 h-12 bg-gradient-to-br from-powder-500 to-powder-600 rounded-lg mb-4 flex items-center justify-center">
                <svg className="w-6 h-6 text-white" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2m-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z" />
                </svg>
              </div>
              <h3 className="text-xl font-bold text-dark-blue mb-3 mt-1">Clear Solutions</h3>
              <p className="text-slate-600 mb-1">
                We cut through complexity to deliver straightforward, effective solutions tailored to your business needs.
              </p>
            </div>

            {/* Feature 2 */}
            <div className="bg-slate-50 rounded-lg py-5 px-6 border border-slate-200 hover:border-powder-300 transition-all transform hover:-translate-y-2">
              <div className="w-12 h-12 bg-gradient-to-br from-powder-500 to-powder-600 rounded-lg mb-4 flex items-center justify-center">
                <svg className="w-6 h-6 text-white" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2m0 18c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8m-2-13h4v6h-4z" />
                </svg>
              </div>
              <h3 className="text-xl font-bold text-dark-blue mb-3 mt-1">Efficiency</h3>
              <p className="text-slate-600 mb-1">
                Automate repetitive processes and save your team valuable time and resources for strategic work.
              </p>
            </div>

            {/* Feature 3 */}
            <div className="bg-slate-50 rounded-lg py-5 px-6 border border-slate-200 hover:border-powder-300 transition-all transform hover:-translate-y-2">
              <div className="w-12 h-12 bg-gradient-to-br from-powder-500 to-powder-600 rounded-lg mb-4 flex items-center justify-center">
                <svg className="w-6 h-6 text-white" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z" />
                </svg>
              </div>
              <h3 className="text-xl font-bold text-dark-blue mb-3 mt-1">Scalable</h3>
              <p className="text-slate-600 mb-1">
                Build systems that grow with your business. Our solutions are designed for long-term success.
              </p>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
