// The Privacy Policy (/privacy) and Terms of Service (/terms), rendered by src/components/LegalDocument.tsx.
// English only: a legal text shouldn't change meaning in translation, so the other languages show a notice
// (legal.englishOnly) above it. When a document's wording changes, change its effective date and its version in
// src/lib/policyVersions.ts together.

// A paragraph, a bold paragraph, a bulleted list, a subheading, or contact lines with links
export type LegalBlock =
  | string
  | { strong: string }
  | { list: string[] }
  | { subheading: string }
  | { contact: { label?: string; text: string; href?: string }[] };

export type LegalSection = { heading: string; blocks: LegalBlock[] };

export type LegalDocumentContent = {
  title: string;
  effectiveDate: string;
  intro: LegalBlock[];
  sections: LegalSection[];
};

const SUPPORT_EMAIL = 'support@racingcoach.app';
const BUSINESS_OPERATOR = 'Clarivex, LLC';

export const privacyPolicy: LegalDocumentContent = {
  title: 'RacingCoach.app Privacy Policy',
  effectiveDate: 'October 26, 2026',
  intro: [
    'RacingCoach.app ("RacingCoach," "we," "our," or "us") respects your privacy and is committed to protecting your personal information.',
    'This Privacy Policy explains how we collect, use, store, share, and protect information when you use our website, applications, telemetry collection software, coaching features, Discord integrations, and related services (collectively, the "Services").',
    'By using RacingCoach, you acknowledge the data practices described in this Privacy Policy.',
  ],
  sections: [
    {
      heading: '1. Information We Collect',
      blocks: [
        { subheading: 'Account Information' },
        'When you register or use RacingCoach, we may collect:',
        {
          list: [
            'Your name, username, and email address.',
            'Account identifiers and authentication information.',
            'Language preferences and application settings.',
            'Subscription status, billing history, and account preferences.',
            'Connected third-party account identifiers.',
          ],
        },
        { subheading: 'Racing and Telemetry Data' },
        'RacingCoach processes sim-racing data to deliver performance analysis and personalized coaching.',
        'Depending on the features you use, this information may include:',
        {
          list: [
            'Lap times, sector times, and race results.',
            'Vehicle speed, throttle, brake, steering, and gear inputs.',
            'Vehicle dynamics, acceleration, and rotation measurements.',
            'Track, vehicle, session, and racing conditions.',
            'Driver performance metrics and comparisons.',
            'Historical racing results and performance trends.',
            'Data imported from telemetry files, supported simulators, and connected services.',
          ],
        },
        'Some telemetry may be collected in real time through locally installed RacingCoach software and transmitted to our servers for processing, storage, and analysis.',
        { subheading: 'Coaching Data' },
        'When you use coaching features, we may process:',
        {
          list: [
            'Your racing telemetry and performance history.',
            'Questions and messages submitted to the coach.',
            'Coaching recommendations and analysis results.',
            'Driver preferences, goals, and coaching settings.',
            'Relevant session and vehicle information.',
          ],
        },
        'We may use third-party service providers to process this information and generate coaching responses.',
        { subheading: 'Technical and Usage Information' },
        'We may automatically collect information such as IP addresses, browser type, operating system, device information, application version, feature usage, diagnostic information, error logs, and security events.',
        { subheading: 'Payment Information' },
        'Subscription payments may be handled by third-party payment processors. We may receive transaction identifiers, payment status, subscription details, and limited billing information.',
        'We do not intentionally collect or store complete payment card numbers or card security codes on RacingCoach servers.',
      ],
    },
    {
      heading: '2. How We Use Your Information',
      blocks: [
        'We use collected information to:',
        {
          list: [
            'Provide and maintain RacingCoach services.',
            'Analyze racing telemetry and driving performance.',
            'Generate personalized coaching recommendations.',
            'Deliver real-time coaching, alerts, and visual overlays.',
            'Display racing history, analytics, and progress reports.',
            'Authenticate users and manage subscriptions.',
            'Support authorized third-party integrations.',
            'Diagnose technical problems and improve reliability.',
            'Detect fraud, misuse, and unauthorized access.',
            'Communicate service updates and important account information.',
            'Comply with applicable legal obligations.',
          ],
        },
        'We may analyze aggregated or de-identified information to understand service performance and improve our products, provided that the information is handled in accordance with applicable law.',
      ],
    },
    {
      heading: '3. Third-Party Integrations',
      blocks: [
        'RacingCoach may integrate with services including iRacing, Discord, authentication providers, and payment processors.',
        'When you connect an external account, we may access and process information that you authorize and that the provider makes available under its applicable permissions and terms.',
        'You can disconnect supported integrations through available account settings or the third-party provider.',
        'Disconnecting an integration does not necessarily delete data previously imported into RacingCoach. You may separately request deletion of applicable stored information.',
        'RacingCoach is an independent service and is not affiliated with, endorsed by, or sponsored by iRacing or Discord unless expressly stated otherwise.',
      ],
    },
    {
      heading: '4. Coaching Analysis',
      blocks: [
        'RacingCoach uses automated analysis to examine telemetry, identify driving patterns, and provide coaching recommendations.',
        'Information submitted for analysis may be transmitted to contracted technology providers solely as necessary to provide the requested functionality and other purposes disclosed in this policy.',
      ],
    },
    {
      heading: '5. Data Sharing',
      blocks: [
        'We do not sell personal information in exchange for money.',
        'We may share information with service providers that support hosting, authentication, payment processing, analytics, data processing, customer support, and other operational functions.',
        'We may also disclose information when required by law, to protect the security of the Services, or as part of a legitimate business transfer, subject to applicable legal requirements.',
      ],
    },
    {
      heading: '6. Data Storage and Security',
      blocks: [
        'We use reasonable technical and organizational safeguards designed to protect information against unauthorized access, alteration, disclosure, and destruction.',
        'These safeguards may include encrypted communications, authentication controls, restricted system access, monitoring, and other security measures.',
        'However, no internet-connected service can guarantee absolute security.',
      ],
    },
    {
      heading: '7. Data Retention',
      blocks: [
        'We retain personal information for as long as reasonably necessary to provide the Services, fulfill the purposes described in this policy, meet legal obligations, resolve disputes, and enforce our agreements.',
        'Telemetry, racing history, and coaching records may be retained while your account is active and for a limited period afterward.',
      ],
    },
    {
      heading: '8. Your Privacy Rights',
      blocks: [
        'Depending on your location and applicable law, you may have rights to:',
        {
          list: [
            'Access personal information we maintain about you.',
            'Request correction of inaccurate information.',
            'Request deletion of eligible personal information.',
            'Obtain a copy of certain personal information.',
            'Withdraw consent where processing depends on consent.',
            'Object to or restrict certain processing activities.',
            'Appeal certain privacy request decisions.',
          ],
        },
        `To submit a request, contact ${SUPPORT_EMAIL}.`,
        'We may need to verify your identity before processing certain requests. We will respond within the period required by applicable law.',
      ],
    },
    {
      heading: '9. Cookies and Similar Technologies',
      blocks: [
        'RacingCoach may use cookies and similar technologies to maintain login sessions, remember preferences, support security, measure usage, and improve the Services.',
        'Where required by law, we will obtain consent before placing nonessential cookies or activating certain tracking technologies.',
      ],
    },
    {
      heading: "10. Children's Privacy",
      blocks: [
        'RacingCoach is not directed to children under the age of 13, and we do not knowingly collect personal information from children under 13.',
        'If we learn that a user is under 13, we will delete their account and the personal information associated with it. If you believe a child under 13 has created an account, please contact us using the details in Section 13.',
        'Users under the age of majority in their jurisdiction should obtain permission from a parent or legal guardian before using the Services.',
      ],
    },
    {
      heading: '11. International Data Processing',
      blocks: [
        'Your information may be processed in countries other than the country where you reside.',
        'Where applicable, we will use legally required safeguards for international transfers of personal information.',
      ],
    },
    {
      heading: '12. Changes to This Policy',
      blocks: [
        'We may update this Privacy Policy periodically to reflect changes to our Services, legal requirements, or information practices.',
        'We will publish the updated policy with a revised effective date and provide additional notice when required by law.',
      ],
    },
    {
      heading: '13. Contact Us',
      blocks: [
        'For privacy questions, data requests, or concerns, contact:',
        {
          contact: [
            { text: 'RacingCoach.app' },
            { label: 'Website', text: 'https://racingcoach.app/support', href: '/support' },
            { label: 'Email', text: SUPPORT_EMAIL, href: `mailto:${SUPPORT_EMAIL}` },
            { label: 'Business Operator', text: BUSINESS_OPERATOR },
          ],
        },
      ],
    },
  ],
};

export const termsOfService: LegalDocumentContent = {
  title: 'RacingCoach.app Terms of Service',
  effectiveDate: 'October 26, 2026',
  intro: [
    'Welcome to RacingCoach.app.',
    'These Terms of Service ("Terms") govern your access to and use of the RacingCoach website, applications, telemetry collection software, coaching tools, analytics, integrations, and related services (collectively, the "Services").',
    `The Services are operated by ${BUSINESS_OPERATOR} ("RacingCoach," "we," "our," or "us").`,
    'By creating an account, purchasing a subscription, or accessing the Services, you agree to these Terms.',
    'If you do not agree, you must not use the Services.',
  ],
  sections: [
    {
      heading: '1. Description of Services',
      blocks: [
        'RacingCoach is a sim-racing performance analysis and coaching platform.',
        'Features may include:',
        {
          list: [
            'Automated driving analysis and coaching recommendations.',
            'Real-time in-car voice coaching and visual guidance.',
            'Telemetry collection, visualization, and analysis.',
            'Lap, sector, corner, and performance comparisons.',
            'Driving history and progress tracking.',
            'Track-specific braking, throttle, and driving recommendations.',
            'Integrations with supported racing simulators and third-party platforms.',
            'Community and Discord-based coaching functionality.',
          ],
        },
        'Features and availability may vary by subscription plan, supported simulator, and technical compatibility.',
      ],
    },
    {
      heading: '2. Account Registration and Eligibility',
      blocks: [
        'You must provide accurate account information and maintain the confidentiality of your login credentials.',
        'You are responsible for activities conducted through your account, except where applicable law provides otherwise.',
        'You must be at least 13 years old, or the minimum age required to use the Services in your jurisdiction, whichever is higher. If you are under the age of majority, you must have the consent of a parent or legal guardian.',
        'We may suspend or terminate accounts that violate these Terms, subject to applicable law.',
      ],
    },
    {
      heading: '3. Subscriptions, Payments, and Renewals',
      blocks: [
        'Certain RacingCoach features require a paid subscription.',
        'Subscription pricing, billing frequency, included features, and applicable taxes will be disclosed before purchase.',
        'If you purchase a recurring subscription, it will automatically renew at the disclosed interval unless you cancel before the next renewal, subject to applicable law.',
        'You authorize our payment processor to charge the payment method associated with your subscription for applicable recurring fees.',
        `You may cancel through the available subscription management interface or by contacting ${SUPPORT_EMAIL}.`,
        'Unless otherwise required by law or expressly stated in the purchase terms, cancellation stops future renewals, and access continues until the end of the current paid billing period.',
        'Refund eligibility is governed by the refund policy disclosed at purchase and applicable consumer protection laws.',
        'We may change subscription prices with advance notice as required by law. Material price changes will not take effect without any consent required by applicable law.',
      ],
    },
    {
      heading: '4. Acceptable Use',
      blocks: [
        'You agree not to:',
        {
          list: [
            'Use RacingCoach for unlawful or fraudulent purposes.',
            'Attempt unauthorized access to accounts, servers, databases, or infrastructure.',
            'Circumvent subscription, licensing, or security controls.',
            'Distribute malware or interfere with service operations.',
            'Use automated systems to abuse or overload the Services.',
            'Reverse engineer, copy, or redistribute proprietary RacingCoach software except where permitted by law.',
            'Resell or commercially exploit the Services without written authorization.',
            'Upload data that you do not have the right to provide.',
            'Misrepresent your identity or impersonate other users.',
          ],
        },
      ],
    },
    {
      heading: '5. Telemetry and User-Provided Data',
      blocks: [
        'You retain ownership of original data that you lawfully own and submit to RacingCoach.',
        'You grant RacingCoach a nonexclusive, worldwide license to host, store, reproduce, process, transform, and display your submitted data solely as reasonably necessary to operate, maintain, secure, and improve the Services as described in these Terms and our Privacy Policy.',
        'This license does not transfer ownership of your original data to RacingCoach.',
        'You represent that you have the necessary rights or permissions to submit and authorize processing of the data.',
        'You acknowledge that simulator telemetry, track information, and racing results may also be subject to third-party intellectual property rights, licenses, and terms.',
        'RacingCoach does not claim ownership of third-party simulator data or content merely because it processes or displays that information.',
      ],
    },
    {
      heading: '6. Coaching and Recommendations',
      blocks: [
        'RacingCoach uses automated analysis to provide driving recommendations.',
        'These recommendations are generated from available telemetry, algorithms, statistical models, and other information.',
        { strong: 'Coaching recommendations are informational and may be inaccurate, incomplete, or unsuitable for a particular driving situation.' },
        'You acknowledge that:',
        {
          list: [
            'Recommendations do not guarantee faster lap times, improved ratings, race victories, or specific results.',
            'Telemetry analysis may be affected by incomplete or inaccurate data.',
            'Automated analysis may produce incorrect or inconsistent conclusions.',
            'You are responsible for evaluating recommendations before applying them.',
            'Real-time coaching may not account for every racing condition or unexpected event.',
          ],
        },
        'RacingCoach is intended for simulated racing environments and is not a substitute for professional instruction or safety training for real-world motorsports.',
        'Do not rely on RacingCoach for real-world vehicle operation or safety-critical driving decisions.',
      ],
    },
    {
      heading: '7. Real-Time Coaching and Software Operation',
      blocks: [
        'RacingCoach may provide live voice instructions, alerts, and visual overlays during simulator sessions.',
        'You are responsible for configuring these features appropriately and ensuring that they do not interfere with safe, lawful, or compliant use of your simulator and related equipment.',
        'We do not guarantee uninterrupted telemetry collection, immediate coaching responses, precise synchronization, or compatibility with every hardware or software configuration.',
        'Software updates, network latency, simulator changes, and system performance may affect functionality.',
      ],
    },
    {
      heading: '8. Third-Party Platforms and Integrations',
      blocks: [
        'RacingCoach may interact with independently operated services, including iRacing and Discord.',
        'These services are governed by their own terms, policies, technical requirements, and access restrictions.',
        'You are responsible for complying with applicable third-party terms.',
        'RacingCoach does not guarantee continued compatibility, availability of external APIs, or uninterrupted access to third-party data.',
        'Third-party providers may modify, restrict, suspend, or discontinue their services or integrations.',
        'Unless expressly stated otherwise, RacingCoach is an independent product and is not endorsed by, sponsored by, or officially affiliated with iRacing, Discord, or other third-party providers.',
        'All third-party trademarks remain the property of their respective owners.',
      ],
    },
    {
      heading: '9. Intellectual Property',
      blocks: [
        'The RacingCoach software, website design, proprietary algorithms, coaching systems, original content, graphics, branding, and other original materials are owned by RacingCoach or its licensors and are protected by applicable intellectual property laws.',
        'Subject to compliance with these Terms, we grant you a limited, nonexclusive, nontransferable, revocable license to access and use the Services for their intended purposes during your authorized access period.',
        'You may not copy, distribute, sublicense, sell, or commercially exploit proprietary RacingCoach technology without prior written permission, except where applicable law permits otherwise.',
        'Nothing in these Terms transfers ownership of third-party intellectual property to RacingCoach.',
      ],
    },
    {
      heading: '10. Service Availability and Modifications',
      blocks: [
        'We may update, modify, replace, or discontinue features to maintain security, improve performance, respond to third-party changes, or support business operations.',
        'We do not guarantee that every feature will remain available indefinitely.',
        'Where required by law, we will provide notice of material changes and any applicable remedies.',
      ],
    },
    {
      heading: '11. Suspension and Termination',
      blocks: [
        'We may suspend or terminate access when reasonably necessary to address security risks, suspected fraud, unlawful activity, material violations of these Terms, or other legitimate operational concerns.',
        'Where appropriate and legally required, we will provide notice and an opportunity to remedy a violation.',
        'You may stop using the Services or cancel your subscription at any time.',
        'Termination does not automatically eliminate payment obligations already lawfully incurred or rights and obligations intended to survive termination.',
      ],
    },
    {
      heading: '12. Disclaimers',
      blocks: [
        'TO THE MAXIMUM EXTENT PERMITTED BY APPLICABLE LAW, THE SERVICES ARE PROVIDED "AS IS" AND "AS AVAILABLE."',
        'WE DISCLAIM IMPLIED WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, AND NON-INFRINGEMENT TO THE EXTENT SUCH DISCLAIMERS ARE LEGALLY PERMITTED.',
        'WE DO NOT WARRANT THAT THE SERVICES WILL BE ERROR-FREE, UNINTERRUPTED, COMPLETELY SECURE, OR THAT COACHING RECOMMENDATIONS WILL PRODUCE SPECIFIC PERFORMANCE RESULTS.',
        'Nothing in these Terms excludes warranties or consumer rights that cannot lawfully be excluded.',
      ],
    },
    {
      heading: '13. Limitation of Liability',
      blocks: [
        'TO THE MAXIMUM EXTENT PERMITTED BY APPLICABLE LAW, RACINGCOACH AND ITS OPERATORS WILL NOT BE LIABLE FOR INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES, INCLUDING LOST PROFITS, LOST DATA, OR BUSINESS INTERRUPTION ARISING FROM USE OF THE SERVICES.',
        'TO THE MAXIMUM EXTENT PERMITTED BY LAW, OUR AGGREGATE LIABILITY ARISING FROM OR RELATING TO THE SERVICES WILL NOT EXCEED THE GREATER OF (A) THE AMOUNT YOU PAID TO RACINGCOACH DURING THE 12 MONTHS BEFORE THE EVENT GIVING RISE TO THE CLAIM OR (B) US $100.',
        'This limitation does not apply where prohibited by law and does not exclude liability that cannot legally be limited, including applicable liability for fraud, intentional misconduct, or personal injury.',
      ],
    },
    {
      heading: '14. Indemnification',
      blocks: [
        'To the extent permitted by applicable law, you agree to indemnify and hold RacingCoach harmless from third-party claims, damages, and reasonable costs arising from your unlawful use of the Services, willful misconduct, or material violation of these Terms.',
        'This provision does not require you to indemnify RacingCoach for its own negligence, misconduct, or violations of law.',
      ],
    },
    {
      heading: '15. Governing Law and Disputes',
      blocks: [
        'These Terms are governed by the laws of the Commonwealth of Kentucky, United States, without regard to conflict-of-law principles, except where mandatory consumer protection laws provide otherwise.',
        'Any disputes will be handled in courts of competent jurisdiction, subject to applicable law and any mandatory consumer rights.',
        'Nothing in these Terms prevents consumers from exercising nonwaivable rights available in their jurisdiction.',
      ],
    },
    {
      heading: '16. Changes to These Terms',
      blocks: [
        'We may revise these Terms to reflect changes in our Services, business operations, or legal obligations.',
        'Updated Terms will be published with a revised effective date. We will provide additional notice and obtain consent where legally required for material changes.',
      ],
    },
    {
      heading: '17. Contact Information',
      blocks: [
        'For questions regarding these Terms, contact:',
        {
          contact: [
            { text: 'RacingCoach.app' },
            { label: 'Website', text: 'https://racingcoach.app', href: '/' },
            { label: 'Email', text: SUPPORT_EMAIL, href: `mailto:${SUPPORT_EMAIL}` },
            { label: 'Business Operator', text: BUSINESS_OPERATOR },
          ],
        },
      ],
    },
  ],
};
