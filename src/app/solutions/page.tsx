interface Solution {
  id: string;
  title: string;
  description: string;
/*   icon: string; */
  benefits: string[];
}

const solutions: Solution[] = [
  {
    id: 'data-analytics',
    title: 'Data Analytics',
    description: 'Transform raw data into actionable insights that drive business decisions and reveal hidden opportunities.',
 /*    icon: '📊', */
    benefits: [
      'Real-time data dashboards and reporting',
      'Predictive analytics for trend forecasting',
      'Data visualization for better decision-making',
      'Identify cost-saving opportunities',
      'Track KPIs and performance metrics',
    ],
  },
  {
    id: 'code-migration',
    title: 'Software Code Migration',
    description: 'Seamlessly migrate your codebase from one programming language to another with minimal disruption.',
   /*  icon: '🔄', */
    benefits: [
      'Modernize legacy systems efficiently',
      'Leverage newer, more efficient languages',
      'Improve code maintainability and performance',
      'Reduce technical debt over time',
      'Comprehensive testing and validation',
    ],
  },
  {
    id: 'web-accessibility',
    title: 'Web Accessibility & Best Practices',
    description: 'Update your web applications to meet WCAG standards and industry best practices for maximum reach.',
/*     icon: '♿', */
    benefits: [
      'WCAG 2.1 compliance (AA/AAA levels)',
      'Improved SEO and search rankings',
      'Broader audience reach and inclusivity',
      'Reduced legal and liability risks',
      'Enhanced user experience for all',
    ],
  },
  {
    id: 'system-integration',
    title: 'Connecting Disparate Systems',
    description: 'Integrate your existing systems and platforms to create a unified, seamless business infrastructure.',
   /*  icon: '🔗', */
    benefits: [
      'API and middleware integration solutions',
      'Real-time data synchronization',
      'Eliminate manual data entry and errors',
      'Improved operational efficiency',
      'Single source of truth for all data',
    ],
  },
  {
    id: 'ai-automation',
    title: 'AI-Powered Process Automation',
    description: 'Leverage AI tools and agents to eliminate manual, error-prone processes and boost productivity.',
   /*  icon: '🤖', */
    benefits: [
      'Intelligent workflow automation',
      'AI agents for document processing',
      'Reduced human error significantly',
      'Cost savings through process optimization',
      'Scalable automation that grows with you',
    ],
  },
];

export default function Solutions() {
  return (
    <div className="w-full">
      {/* Header Section */}
      <section className="py-8 px-3 sm:px-5 lg:px-8 bg-gradient-to-b from-slate-100 to-white border-b border-slate-200">
        <div className="max-w-6xl mx-auto text-center">
          <h1 className="text-4xl md:text-5xl font-bold mb-4 bg-gradient-to-r from-powder-600 via-powder-500 to-powder-600 bg-clip-text text-transparent">
            Our Solutions
          </h1>
          <p className="text-lg text-slate-600 text-center">
            Comprehensive services designed to address your unique business challenges and drive real results.
          </p>
        </div>
      </section>

      {/* Solutions Grid */}
      <section className="py-8 px-2 sm:px-3 lg:px-4 bg-white">
        <div className="max-w-6xl mx-auto">
          <div className="flex flex-wrap justify-center gap-8 lg:gap-12">
            {solutions.map((solution) => (
              <div
                key={solution.id}
                className="bg-slate-50 rounded-xl border border-slate-200 hover:border-powder-300 p-6 transition-all duration-300 transform hover:-translate-y-2 group w-full md:w-[calc(50%-1rem)] lg:w-[calc(50%-1.5rem)]"
              >
                {/* Icon and Title */}
                <div className="mb-3 px-1">
            {/*       <div className="text-5xl mb-4 inline-block p-4 bg-white rounded-lg group-hover:bg-powder-100 transition-colors">
                    {solution.icon}
                  </div> */}
                  <h2 className="text-2xl font-bold text-dark-blue group-hover:text-powder-600 transition-colors">
                    {solution.title}
                  </h2>
                </div>

                {/* Description */}
                <p className="text-slate-600 mb-3 text-base leading-relaxed px-1">
                  {solution.description}
                </p>

                {/* Benefits */}
                <div className="space-y-3 mb-4 px-1">
                  <p className="text-powder-600 font-semibold text-sm uppercase tracking-wide">
                    Key Activities
                  </p>
                  <ul className="space-y-2">
                    {solution.benefits.map((benefit, idx) => (
                      <li key={idx} className="flex items-start gap-3">
                        <span className="text-powder-600 font-bold flex-shrink-0 mt-0.5">
                          ✓
                        </span>
                        <span className="text-slate-600">{benefit}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

<br />

      {/* Process Section */}
      <section className="py-8 px-2 sm:px-3 lg:px-4 bg-slate-50 border-t border-slate-200 flex flex-col items-center">
        <div className="w-full max-w-4xl">
          <h2 className="text-3xl font-bold text-center text-dark-blue mb-6">
            Our Process
          </h2>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            {[
              { step: '1', title: 'Discovery', desc: 'Understand your challenges and goals' },
              { step: '2', title: 'Strategy', desc: 'Design the optimal solution approach' },
              { step: '3', title: 'Implementation', desc: 'Execute with precision and care' },
              { step: '4', title: 'Support', desc: 'Ongoing maintenance and optimization' },
            ].map((item) => (
              <div key={item.step} className="text-center">
                <div className="w-16 h-16 bg-gradient-to-br from-powder-500 to-powder-600 rounded-full flex items-center justify-center mx-auto mb-4 shadow-lg shadow-powder-500/30">
                  <span className="text-2xl font-bold text-white">
                    {item.step}
                  </span>
                </div>
                <h3 className="text-lg font-bold text-dark-blue mb-2">
                  {item.title}
                </h3>
                <p className="text-slate-600 text-sm">{item.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-8 px-2 sm:px-3 lg:px-4 bg-slate-100 border-t border-slate-200 flex flex-col items-center">
        <div className="w-full max-w-4xl text-center">
          <h2 className="text-3xl font-bold mb-3 text-dark-blue">
            Which solution is right for you?
          </h2>
          <p className="text-lg text-slate-600 mb-4">
            Let&apos;s explore how these solutions can address your specific business needs.
          </p>
        </div>
      </section>
    </div>
  );
}
