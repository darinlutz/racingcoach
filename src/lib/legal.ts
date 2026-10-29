// The Privacy Policy (/privacy), Terms of Service (/terms) and Cookie Policy (/cookies), rendered by
// src/components/LegalDocument.tsx. English only: a legal text shouldn't change meaning in translation, so the other
// languages show a notice (legal.englishOnly) above it. When the Privacy Policy's or Terms' wording changes, change
// its effective date and its version in src/lib/policyVersions.ts together; for the Cookie Policy, its effective date
// and COOKIE_POLICY_VERSION in src/lib/cookieConsent.ts (it isn't something users accept, so it isn't in
// policyVersions.ts). Imports only plain .ts files, so Node runs it directly (scripts/exportLegal.mjs).
import { COOKIE_POLICY_VERSION, DEFAULT_CONSENT_REVIEW_DAYS } from './cookieConsent.ts';
import { COOKIE_INVENTORY, type InventoryItem } from './cookieInventory.ts';

// A paragraph, a bold paragraph, a bulleted list, a subheading, contact lines with links, a table, or a button that
// opens Cookie Settings (a plain sentence pointing to the footer where there's no page to open it on)
export type LegalBlock =
  | string
  | { strong: string }
  | { list: string[] }
  | { subheading: string }
  | { contact: { label?: string; text: string; href?: string }[] }
  | { table: { caption: string; headers: string[]; rows: string[][] } }
  | { cookieSettings: string };

// id, when given, is the section's anchor (e.g. /privacy#lap-telemetry-retention)
export type LegalSection = { heading: string; id?: string; blocks: LegalBlock[] };

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
  effectiveDate: 'October 29, 2026',
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
        'Only if you accept analytics cookies, our website also keeps its own activity log of the pages you view and the links and buttons you click, with your IP address, browser user agent, screen size, and language, and your account when you are signed in. It never records what you type into forms. See our Cookie Policy for details.',
        { subheading: 'Cookie Choices' },
        'When you make a choice in our cookie banner or Cookie Settings, we keep a record of it: a random identifier for your browser, your account if you are signed in, the date and time, the choices you made, the versions of the notice and Cookie Policy you were shown, and your region when it is known. We do not store your IP address or browser details with it.',
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
        { subheading: 'Legal Bases for Processing' },
        'Where the GDPR, the UK GDPR, or similar laws apply, we rely on the following legal bases. Consent is not the basis for most of our processing; it applies only where stated below.',
        {
          list: [
            'Performance of a contract: to create and run your account, record, store, and analyze your laps and telemetry, provide coaching and the other features you use, process subscriptions, and respond to your support requests.',
            'Legitimate interests: to keep the Services secure, prevent fraud and misuse, limit abuse of AI features, diagnose problems through security and collector logs, use the strictly necessary cookies the website needs, and improve the Services using aggregated information. You may object to processing based on legitimate interests.',
            'Consent: for optional cookies and our website activity log (see Section 10 and our Cookie Policy). You can withdraw consent at any time in Cookie Settings, without affecting processing that took place before you withdrew it.',
            'Legal obligations: to keep billing and tax records, respond to lawful requests, and keep records showing the cookie choices you made.',
          ],
        },
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
        'Different categories of information are kept for different periods:',
        {
          list: [
            'Lap telemetry and the Debrief Coach analyses saved from it are kept only for the limited periods described in Section 8.',
            'Account records, settings, racing results, and coaching instructions are kept while your account is open.',
            'Activity logs sent by the RacingCoach collector are kept for 90 days.',
            'Billing, subscription, and cancellation records are kept as long as reasonably necessary for accounting, tax, and legal obligations, including after an account is deleted.',
            'Website activity and security logs are kept as long as reasonably necessary for security, fraud prevention, and improving the Services.',
            `Records of your cookie choices are kept for 3 years after each choice, to show the choices you made, and then deleted. Your choice itself is remembered in your browser for ${DEFAULT_CONSENT_REVIEW_DAYS} days, after which we ask again.`,
          ],
        },
        'Deleting your account from My Settings deletes your lap telemetry and the other information tied to your account, except the billing records, cancellation feedback (without your name and email address), activity and security logs, and records of your cookie choices (no longer linked to your account) described above.',
      ],
    },
    {
      heading: '8. Lap Telemetry Retention and Deletion',
      id: 'lap-telemetry-retention',
      blocks: [
        `RacingCoach.app, operated by ${BUSINESS_OPERATOR}, retains identifiable lap telemetry for a limited period based on the user's membership level. Lap telemetry means the laps recorded by the RacingCoach collector and uploaded to your account, which include measurements such as speed, pedal, steering, gear, tire, fuel, and track position for every sample of a lap, and the Debrief Coach analyses saved from them.`,
        {
          list: [
            'Bronze (free) members: up to thirty (30) days after the lap was completed.',
            'Silver members: up to sixty (60) days after the lap was completed.',
            'Gold members: up to ninety (90) days after the lap was completed.',
          ],
        },
        { strong: 'Under no circumstances will identifiable lap telemetry remain in active application storage for more than ninety (90) days after the lap was completed.' },
        'Retention periods are calculated from the original completion time of each lap as recorded by the RacingCoach collector (or the time we received the lap, if that is earlier), not the date on which telemetry is uploaded, imported, analyzed, or reprocessed. Uploading a lap again never restarts its retention period. Saved Debrief Coach analyses are subject to the same periods, calculated from the time the analysis was saved.',
        'When a lap\'s applicable retention period expires, RacingCoach.app automatically makes the associated telemetry unavailable throughout the Services, including the website, coaching and AI analysis features, and integrations, and schedules its permanent deletion from active application storage. Each lap\'s scheduled deletion date is shown with your recorded laps.',
        'These periods reflect the amount of lap history each membership level provides for lap comparison and coaching. We do not keep lap telemetry longer than needed for that purpose.',
        { subheading: 'Membership Changes' },
        {
          list: [
            'Upgrading extends the retention period of laps that have not yet expired to the new level\'s period.',
            'Downgrading shortens the retention period of laps that have not yet expired to the new level\'s period. Laps older than the new period become unavailable immediately and are deleted.',
            'When a paid membership is canceled or not renewed, it remains in effect until the end of the paid period. The account then becomes a Bronze membership, and the Bronze period applies to its laps.',
            'As a grace period and a measure of goodwill, when a Gold membership ends, laps that were within the Gold period remain available for seven (7) days after the end of the paid period, but never more than ninety (90) days after they were completed.',
          ],
        },
        'Previously deleted or expired telemetry cannot be recovered by upgrading, renewing, or resubscribing, or by uploading the lap again from the RacingCoach collector. You can download a lap from your recorded laps before its deletion date if you wish to keep a copy.',
        { subheading: 'Laps Stored on Your Computer' },
        'The RacingCoach collector keeps a local copy of each lap on your computer only until the lap has been uploaded and its track positions have been added. Laps that are not uploaded are deleted from your computer ninety (90) days after they were completed, and laps that RacingCoach.app refuses because their retention period has already expired are deleted from your computer immediately. To capture track positions, the collector turns on the iRacing simulator\'s telemetry recording; the collector deletes iRacing telemetry (.ibt) files in your iRacing telemetry folder that are more than ninety (90) days old.',
        { subheading: 'Information Not Covered by These Periods' },
        {
          list: [
            'A lap you select as your Target Lap is reference content you choose. It is kept until you replace or remove it, or delete your account.',
            'Expert Laps provided by RacingCoach coaches are coaching content made available to all users and are not subject to these periods.',
            'Track maps and outlines derived from laps do not identify you and are kept.',
          ],
        },
        { subheading: 'Deletion on Request, Backups, and Service Providers' },
        `You may delete your account at any time from My Settings, which immediately deletes your lap telemetry from active application storage, or request deletion of your personal data before the applicable retention period expires by contacting ${SUPPORT_EMAIL}, subject to any lawful exceptions.`,
        'Limited copies of information may remain temporarily in database backups kept by our hosting provider for disaster recovery under its backup retention schedule. Such backups are not used for ordinary application access, and expired lap telemetry in data restored from a backup is made unavailable automatically and deleted under these rules before the restored data is used.',
        'When you use AI coaching features, measurements derived from your laps are sent to the technology providers that generate coaching responses. Those providers handle that information under their own terms and retention practices, and deletion of lap telemetry from RacingCoach.app does not delete copies such providers may hold.',
        'Other categories of personal information, including account records, payment information, security logs, and racing results, are subject to the separate retention periods described in Section 7.',
      ],
    },
    {
      heading: '9. Your Privacy Rights',
      blocks: [
        'Depending on your location and applicable law, you may have rights to:',
        {
          list: [
            'Access personal information we maintain about you.',
            'Request correction of inaccurate information.',
            'Request deletion of eligible personal information.',
            'Obtain a copy of certain personal information, including in a portable format.',
            'Withdraw consent where processing depends on consent. For cookies, use the Cookie Settings link at the bottom of every page.',
            'Object to or restrict certain processing activities, including processing based on legitimate interests.',
            'Appeal certain privacy request decisions.',
            'Lodge a complaint with the data protection supervisory authority where you live or work, if you are in the EEA, the UK, or Switzerland.',
          ],
        },
        `To submit a request, contact ${SUPPORT_EMAIL}.`,
        'We may need to verify your identity before processing certain requests. We will respond within the period required by applicable law.',
      ],
    },
    {
      heading: '10. Cookies and Similar Technologies',
      id: 'cookies',
      blocks: [
        'Our website uses strictly necessary cookies and browser storage to keep you signed in, protect sign-ins, remember your cookie choices, and remember the language, theme, units, and layout you pick. These are needed to provide the website and are used on the basis of our legitimate interest in providing it as you request.',
        'With your consent only, the website also uses analytics cookies for our own activity log of page views and clicks. They are off until you choose Accept All, or turn Analytics on in Customize. Choosing Reject All, or closing or ignoring the banner, leaves them off, and you can use the website either way.',
        'We do not use advertising cookies, remarketing pixels, third-party analytics, or social media plugins.',
        'Accepting the Terms of Service or acknowledging this Privacy Policy is not consent to optional cookies; we ask about those separately in the cookie banner.',
        'You can change or withdraw your choice at any time with the Cookie Settings link at the bottom of every page. Withdrawing takes effect immediately and deletes the analytics cookie and browser storage. Our Cookie Policy at https://racingcoach.app/cookies lists every cookie we use, what it is for, and how long it lasts.',
      ],
    },
    {
      heading: "11. Children's Privacy",
      blocks: [
        'RacingCoach is not directed to children under the age of 13, and we do not knowingly collect personal information from children under 13.',
        'If we learn that a user is under 13, we will delete their account and the personal information associated with it. If you believe a child under 13 has created an account, please contact us using the details in Section 14.',
        'Users under the age of majority in their jurisdiction should obtain permission from a parent or legal guardian before using the Services.',
      ],
    },
    {
      heading: '12. International Data Processing',
      blocks: [
        `RacingCoach.app is operated by ${BUSINESS_OPERATOR} from the United States, and our servers and database are hosted in the United States. If you use the Services from another country, including from the European Economic Area, the United Kingdom, or Switzerland, your information is transferred to and processed in the United States.`,
        'Some of our service providers, for example for hosting, payments, email delivery, speech, and AI coaching, may also process information in the United States or other countries.',
        'Where the law of your country requires a transfer mechanism, we rely on mechanisms recognized under that law, such as the Standard Contractual Clauses approved by the European Commission (with the UK Addendum where applicable) in our service providers’ data processing terms, or a provider’s certification under the EU-U.S. Data Privacy Framework and its UK and Swiss extensions where it participates. You can ask us for more information about these safeguards using the contact details in Section 14.',
      ],
    },
    {
      heading: '13. Changes to This Policy',
      blocks: [
        'We may update this Privacy Policy periodically to reflect changes to our Services, legal requirements, or information practices.',
        'We will publish the updated policy with a revised effective date and provide additional notice when required by law.',
      ],
    },
    {
      heading: '14. Contact Us',
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
  effectiveDate: 'October 28, 2026',
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
        { subheading: 'Telemetry Storage and Retention' },
        'Lap telemetry storage is a time-limited feature of the RacingCoach.app membership levels.',
        'The Bronze (free) membership provides up to thirty (30) days of lap telemetry retention, Silver memberships up to sixty (60) days, and Gold memberships up to ninety (90) days, measured from the original completion time of each lap.',
        'Lap telemetry is automatically made unavailable and removed when its applicable retention period expires. No membership level permits retention of identifiable lap telemetry in active application storage beyond ninety (90) days.',
        'Membership changes may shorten or extend the retention period for existing, unexpired laps, but will not restore telemetry that has already expired or been deleted. When a paid membership is canceled or not renewed, the Bronze retention period applies once the paid period ends, except that laps covered by a Gold membership remain available for a seven (7) day grace period after the paid period ends, as described in the Privacy Policy.',
        'You are responsible for downloading any lap telemetry you wish to preserve before its deletion date, using the download feature available with your recorded laps.',
        'The retention and deletion of lap telemetry, including after a membership is canceled or expires, is further described in the "Lap Telemetry Retention and Deletion" section of our Privacy Policy.',
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

const KIND_NAMES: Record<InventoryItem['kind'], string> = {
  cookie: 'Cookie',
  localStorage: 'Local storage',
  sessionStorage: 'Session storage',
};

// One category's rows of src/lib/cookieInventory.ts as a table, so the policy always lists what the site sets
function inventoryTable(category: InventoryItem['category'], caption: string): LegalBlock {
  return {
    table: {
      caption,
      headers: ['Name', 'Type', 'Provider', 'Purpose', 'Duration'],
      rows: COOKIE_INVENTORY.filter((item) => item.category === category).map((item) => [
        item.name,
        `${KIND_NAMES[item.kind]}, ${item.firstParty ? 'first-party' : 'third-party'}${item.httpOnly ? ', not readable by page scripts (HttpOnly)' : ''}`,
        item.provider,
        item.purpose,
        item.duration,
      ]),
    },
  };
}

export const cookiePolicy: LegalDocumentContent = {
  title: 'RacingCoach.app Cookie Policy',
  effectiveDate: 'October 29, 2026',
  intro: [
    `This Cookie Policy explains how RacingCoach.app, operated by ${BUSINESS_OPERATOR}, a company based in Kentucky, United States ("we," "our," or "us"), uses cookies and similar technologies on the racingcoach.app website. It should be read together with our Privacy Policy, which explains how we handle personal information more generally.`,
    `Version ${COOKIE_POLICY_VERSION}.`,
  ],
  sections: [
    {
      heading: '1. What Cookies and Similar Technologies Are',
      blocks: [
        'Cookies are small text files that a website asks your browser to store and send back on later visits. Websites can also store information in your browser in other ways, such as local storage, which stays until it is cleared, and session storage, which is cleared when you close the browser tab. In this policy, "cookies" includes these similar technologies.',
        'First-party cookies are set by the website you are visiting. Third-party cookies are set by a different website, for example an advertising or analytics provider. Every cookie and storage item on racingcoach.app is first-party.',
      ],
    },
    {
      heading: '2. How We Use Them',
      blocks: [
        'We use two kinds:',
        {
          list: [
            'Strictly necessary cookies, which the website needs to work and stay secure, or to provide something you asked for, such as staying signed in or showing pages in the language you chose. They do not require consent and cannot be turned off in Cookie Settings.',
            'Analytics cookies, which are optional and only used if you agree.',
          ],
        },
        'We do not use functional cookies beyond those listed as strictly necessary, and we do not use advertising cookies, remarketing pixels, cross-site tracking, third-party analytics services, or social media plugins. If that changes, we will update this policy and ask for your consent before using them.',
      ],
    },
    {
      heading: '3. Strictly Necessary Cookies',
      blocks: [
        'The cookies below that remember your language, theme, units, layout, and Live Racing options store only a choice you made yourself, so the website can show itself as you asked. The sign-in cookies for Google and Discord are only set when you choose to use those services.',
        inventoryTable('necessary', 'Strictly necessary cookies and browser storage'),
      ],
    },
    {
      heading: '4. Analytics Cookies (Optional)',
      blocks: [
        'With your consent, our website keeps its own activity log: the address and title of each page you view (with any secret values removed from the address), the page you came from, each link, button, or other control you click and its visible label, your screen size and language, and, added by our server when the information arrives, your IP address, your browser user agent, and your account if you are signed in. It never records anything you type into a form. We use it to understand how the website is used and to improve it. It is stored in our own database and is not shared with advertisers or analytics companies.',
        'Until you consent, the activity log does not run: no analytics cookie or storage is set and no activity is sent, and our server refuses activity from browsers that have not consented.',
        inventoryTable('analytics', 'Analytics cookies and browser storage'),
      ],
    },
    {
      heading: '5. Third-Party Services',
      blocks: [
        'No third party sets cookies or loads scripts on racingcoach.app pages. Our fonts are served from our own website, and satellite map images are fetched by our server rather than your browser.',
        'Some features take you to another company’s website when you choose to use them. That website may set its own cookies under its own policies, which we do not control and cannot delete:',
        {
          list: [
            'Stripe, when you subscribe or pay (Stripe Checkout): https://stripe.com/privacy',
            'Google, when you choose to sign in with Google: https://policies.google.com/privacy',
            'Discord, when you choose to connect your Discord account: https://discord.com/privacy',
            'GitHub, when you download the RacingCoach collector: https://docs.github.com/site-policy/privacy-policies/github-general-privacy-statement',
          ],
        },
        'You can manage or delete those cookies in your browser or through those companies’ own settings.',
      ],
    },
    {
      heading: '6. How We Ask for and Record Consent',
      id: 'consent',
      blocks: [
        'The first time you visit, a banner offers Accept All, Reject All, and Customize, presented equally. No optional cookie is used before you choose, and scrolling, browsing, or closing the page is not taken as consent. You can use the website whichever you choose.',
        `Your choice is stored in the cookie_consent cookie for ${DEFAULT_CONSENT_REVIEW_DAYS} days. After that, or sooner if we make a significant change to how we use optional cookies, we ask again; until you answer, optional cookies stay off. A choice applies to the browser you made it in, so you may be asked again on another device, even if you are signed in.`,
        'To be able to show the choices you made, we keep a record of each one: a random identifier for your browser, your account if you are signed in (or sign in later on that browser), the date and time (UTC), the choices you made and whether you accepted, rejected, customized, updated, or withdrew consent, the versions of this policy and of the banner you were shown, the language they were shown in, whether you made the choice in the banner or in Cookie Settings, and the region your visit came from when our hosting network provides it. We do not store your IP address, browser details, or precise location with it. These records are kept for 3 years after each choice and then deleted.',
      ],
    },
    {
      heading: '7. Changing or Withdrawing Your Consent',
      id: 'cookie-settings',
      blocks: [
        'You can change your choice at any time, as easily as you made it, with the Cookie Settings link at the bottom of every page, or here:',
        { cookieSettings: 'Open Cookie Settings' },
        'Withdrawing consent takes effect immediately: the activity log stops, nothing further is sent, and the visitor_id cookie and activitySessionId storage are deleted. It does not sign you out or affect any other feature. Withdrawing does not affect activity recorded while you had consented; to have that deleted, contact us.',
        'You can also block or delete cookies in your browser settings. If you block strictly necessary cookies, signing in and some other features will not work.',
      ],
    },
    {
      heading: '8. Changes to This Policy',
      blocks: [
        'We will update this policy when the cookies we use change, with a new version and effective date. If we start using a new kind of optional cookie or use one for a new purpose, we will ask for your consent again before using it.',
      ],
    },
    {
      heading: '9. Contact Us',
      blocks: [
        'For questions about this policy or our use of cookies, contact:',
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
