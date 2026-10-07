import Link from 'next/link';

export default function Footer() {
  const currentYear = new Date().getFullYear();

  return (
    <footer className="bg-slate-50 border-t border-slate-200 text-dark-blue">
      <div className="max-w-7xl mx-auto px-2 sm:px-3 lg:px-4 py-6">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 mb-8">
          {/* About */}
          <div>
            <h3 className="text-lg font-bold text-powder-600 mb-4">Clarivex</h3>
            <p className="text-slate-600">
              Tackling complex problems with clear solutions. We help businesses automate and streamline their repetitive processes.
            </p>
          </div>

          {/* Quick Links */}
          <div>
            <h3 className="text-lg font-bold text-powder-600 mb-4">Quick Links</h3>
            <ul className="space-y-2">
              <li>
                <Link
                  href="/"
                  className="text-slate-600 hover:text-powder-600 transition-colors"
                >
                  Home
                </Link>
              </li>
              <li>
                <Link
                  href="/solutions"
                  className="text-slate-600 hover:text-powder-600 transition-colors"
                >
                  Solutions
                </Link>
              </li>
            </ul>
          </div>

          {/* Contact Info */}
          <div>
            <h3 className="text-lg font-bold text-powder-600 mb-4">Contact</h3>
            <p className="text-slate-600 mb-2">
              Email:{' '}
              <a href="mailto:client12ramsey@gmail.com" className="text-powder-600 hover:text-powder-700">
                client12ramsey@gmail.com
              </a>
            </p>
            <p className="text-slate-600">
              Ready to solve your business challenges? Get in touch today!
            </p>
          </div>
        </div>

        {/* Divider */}
        <div className="border-t border-slate-200 my-8"></div>

        {/* Copyright */}
        <div className="text-center text-slate-500">
          <p>
            &copy; {currentYear} Clarivex. All rights reserved. | Tackling complex problems with clear solutions.
          </p>
        </div>
      </div>
    </footer>
  );
}
