import type { PrivacyContent } from '../privacy-content.types';

const LINK = 'class="text-accent dark:text-[var(--brand-amber)] underline hover:text-accent-dark dark:hover:text-white"';

export const privacyContent: PrivacyContent = {
  title: 'Privacy Policy',
  updated: 'Last updated: 27 September 2026',
  tocHeading: 'Contents',
  cookieSettingsIntro:
    'You can change or withdraw your consent here at any time. Changes take effect immediately and apply to future page views.',
  sections: [
    {
      id: 'verantwortlicher',
      heading: 'Controller',
      blocks: [
        {
          type: 'p',
          text: 'The controller for data processing on this website within the meaning of the GDPR is:'
        },
        {
          type: 'p',
          text:
            'Nürnberg Renegades e.V.<br>Bartholomäusstr. 26c<br>90489 Nürnberg, Germany<br>' +
            'Represented by: Andreas Scherm (Chairman)<br>' +
            'Registered in the Nürnberg register of associations, VR 202816'
        },
        {
          type: 'p',
          text:
            'Email for data protection matters: <a href="mailto:it&#64;nuernberg-renegades.de" ' +
            LINK +
            '>it&#64;nuernberg-renegades.de</a><br>General contact: <a href="mailto:info&#64;nuernberg-renegades.de" ' +
            LINK +
            '>info&#64;nuernberg-renegades.de</a>'
        },
        {
          type: 'p',
          text:
            'We have not appointed a data protection officer, as the legal requirements for doing ' +
            'so (Art. 37 GDPR, § 38 BDSG) do not apply to us.'
        }
      ]
    },
    {
      id: 'ueberblick',
      heading: 'What we process — an overview',
      blocks: [
        {
          type: 'p',
          text:
            'This website is deliberately built to collect as little as possible. It uses no ' +
            'advertising or tracking technology, embeds no analytics service and builds no usage ' +
            'profiles. Fonts are served from our own server, so simply opening a page creates no ' +
            'connection to Google.'
        },
        { type: 'p', text: 'Personal data arises in essentially four places:' },
        {
          type: 'ul',
          items: [
            'when you open the website (server log data, in particular your IP address),',
            'when you open the results pages, because your browser fetches the match data from ' +
              'our database at Supabase in Frankfurt am Main,',
            'when you submit one of our forms (contact, trial training, membership application),',
            'when you consent to the Google Maps embeds on the training page.'
          ]
        },
        { type: 'h3', text: 'Categories of data subjects' },
        {
          type: 'ul',
          items: [
            'Visitors to this website',
            'People who contact us through a form',
            'People who apply for membership'
          ]
        }
      ]
    },
    {
      id: 'rechtsgrundlagen',
      heading: 'Legal bases',
      blocks: [
        {
          type: 'p',
          text:
            'We process personal data on the following legal bases. Which one applies in a given ' +
            'case is stated with the relevant processing activity.'
        },
        {
          type: 'ul',
          items: [
            '<strong>Art. 6(1)(a) GDPR — consent:</strong> for Google Maps and for storing your language and theme preferences. § 25(1) TDDDG additionally applies to storing and reading information on your device.',
            '<strong>Art. 6(1)(b) GDPR — contract and pre-contractual steps:</strong> for handling membership applications and trial training enquiries.',
            '<strong>Art. 6(1)(f) GDPR — legitimate interests:</strong> for the technically secure operation of the website, defence against spam and automated attacks, and answering general enquiries.',
            '<strong>§ 25(2) no. 2 TDDDG:</strong> for strictly necessary storage, such as saving your cookie decision.'
          ]
        }
      ]
    },
    {
      id: 'hosting',
      heading: 'Hosting and server logs',
      blocks: [
        {
          type: 'p',
          text:
            'This website is hosted by Netlify, Inc., 512 2nd Street, Suite 200, San Francisco, ' +
            'CA 94107, USA. Netlify processes the data on our behalf under a data processing ' +
            'agreement pursuant to Art. 28 GDPR.'
        },
        {
          type: 'p',
          text:
            'When you open a page, your browser transmits technically necessary data that is ' +
            'processed in server log files: IP address, date and time of access, the address ' +
            'requested, the referrer, and browser and operating system identifiers. Without your ' +
            'IP address we could not deliver the page to you.'
        },
        {
          type: 'p',
          text:
            'The legal basis is Art. 6(1)(f) GDPR. Our legitimate interest lies in providing the ' +
            'website reliably and securely. We do not evaluate these logs ourselves and do not ' +
            'combine them with other data.'
        },
        {
          type: 'p',
          text:
            'As Netlify is a US company, data may be transferred to the USA. Such transfers are ' +
            'safeguarded by the European Commission\'s standard contractual clauses or — where the ' +
            'provider is certified — by the EU-U.S. Data Privacy Framework.'
        }
      ]
    },
    {
      id: 'schriftarten',
      heading: 'Fonts',
      blocks: [
        {
          type: 'p',
          text:
            'We use the typefaces “Manrope” and “Sora”. Both are served exclusively from our own ' +
            'server. <strong>No connection to Google Fonts or any other third party</strong> is ' +
            'made, and your IP address is not transmitted to anyone for this purpose.'
        }
      ]
    },
    {
      id: 'cookies',
      heading: 'Cookies and local storage',
      blocks: [
        {
          type: 'p',
          text:
            'We use no advertising or tracking cookies. Only the following is stored, in each case ' +
            'locally in your browser (localStorage and a cookie of the same name):'
        },
        {
          type: 'table',
          head: ['Name', 'Purpose', 'Legal basis', 'Retention'],
          rows: [
            [
              'cookie-consent',
              'Stores your choice in the cookie banner so we do not have to ask again on every visit.',
              '§ 25(2) no. 2 TDDDG (strictly necessary)',
              'Until you clear your browser storage'
            ],
            [
              'preferredLanguage',
              'Remembers whether you want to read the site in German or English.',
              'Consent (“Preferences” category)',
              'Until you clear your browser storage'
            ],
            [
              'preferredTheme',
              'Remembers whether you prefer the light or dark theme.',
              'Consent (“Preferences” category)',
              'Until you clear your browser storage'
            ]
          ]
        },
        {
          type: 'p',
          text:
            'These entries do not expire automatically. You can delete them at any time through ' +
            'your browser settings; the website will continue to work, it simply will not remember ' +
            'your choices.'
        },
        { type: 'h3', text: 'Your consent' },
        {
          type: 'p',
          text:
            'On your first visit we ask whether you consent to anything beyond the technically ' +
            'necessary functions. Nothing is pre-selected: without your active consent, no ' +
            'preferences are stored and no maps are loaded. You can change or withdraw your consent ' +
            'at the top of this page at any time, with effect for the future.'
        }
      ]
    },
    {
      id: 'ergebnisse',
      heading: 'Results, tables and the live ticker',
      blocks: [
        {
          type: 'p',
          text:
            'The results pages show fixtures, results and league tables for both our teams. ' +
            'That data sits in our own database at Supabase, in their Frankfurt am Main data ' +
            'centre. When you open a results page your browser fetches it from there, which — ' +
            'as with any page request — transmits your IP address. The live ticker additionally ' +
            'holds an open connection to that database for as long as you keep the page open, ' +
            'so the score updates without a reload.'
        },
        {
          type: 'p',
          text:
            'The legal basis is our legitimate interest under Art. 6(1)(f) GDPR in showing our ' +
            "teams' results up to date. No cookies are set and no usage behaviour is analysed."
        },
        {
          type: 'p',
          text:
            'The match data itself comes from LeagueSphere, our association\'s match platform. ' +
            'Only a server-side service of ours fetches it, at regular intervals. Your browser ' +
            'never contacts LeagueSphere and no data about you is transmitted there.'
        },
        {
          type: 'p',
          text:
            'Until September 2026 this section embedded a display from an external provider ' +
            '(GitHub Pages, USA). We have removed that embed; opening the results pages no ' +
            'longer contacts any third party.'
        }
      ]
    },
    {
      id: 'formulare',
      heading: 'Our forms',
      blocks: [
        {
          type: 'p',
          text:
            'All three forms work the same way: your input is passed to a server function at ' +
            'Supabase, which composes an email and sends it to our club mailbox via the provider ' +
            'Resend. <strong>Nothing is stored in a database</strong> — afterwards the data exists ' +
            'only as an email in our mailbox.'
        },
        { type: 'h3', text: 'Contact form' },
        {
          type: 'p',
          text:
            'We process your name, email address, subject and message. The legal basis is ' +
            'Art. 6(1)(f) GDPR (legitimate interest in answering your enquiry); if your enquiry ' +
            'is aimed at a contract, it is Art. 6(1)(b) GDPR.'
        },
        { type: 'h3', text: 'Trial training enquiry' },
        {
          type: 'p',
          text:
            'We process your name and email address and — if you provide them — phone number, age, ' +
            'previous experience and your message. The legal basis is Art. 6(1)(b) GDPR ' +
            '(pre-contractual steps).'
        },
        { type: 'h3', text: 'Membership application' },
        {
          type: 'p',
          text:
            'To admit you to the association we need your first and last name, date of birth, place ' +
            'of birth, address, email address and preferred joining date. Occupation, nationality ' +
            'and phone, mobile and fax numbers are optional.'
        },
        {
          type: 'p',
          text:
            'If you wish to grant us a SEPA direct debit mandate, we additionally process the ' +
            '<strong>account holder, IBAN, BIC and bank name</strong>. These details are optional; ' +
            'membership is possible without them, but the fee must then be paid another way. We use ' +
            'payment details solely to collect the membership fee.'
        },
        {
          type: 'p',
          text:
            'From your entries we automatically generate a completed PDF of the application form, ' +
            'which is attached to the notification email. The legal basis is Art. 6(1)(b) GDPR ' +
            '(establishing and performing the membership relationship).'
        },
        { type: 'h3', text: 'How long we keep the data' },
        {
          type: 'p',
          text:
            'We delete contact and trial training enquiries once they have been dealt with and no ' +
            'follow-up questions are expected. Membership application data is kept for the duration ' +
            'of the membership. Statutory retention periods remain unaffected — in particular the ' +
            'six and ten year periods under § 257 HGB and § 147 AO; for that period processing is ' +
            'restricted rather than the data deleted.'
        }
      ]
    },
    {
      id: 'recaptcha',
      heading: 'Google reCAPTCHA',
      blocks: [
        {
          type: 'p',
          text:
            'To protect our forms against automated submissions we use reCAPTCHA v3 from Google ' +
            'Ireland Limited, Gordon House, Barrow Street, Dublin 4, Ireland.'
        },
        {
          type: 'p',
          text:
            'reCAPTCHA is <strong>not loaded on every page</strong>, only on pages containing a ' +
            'form — and there only once you actually click into or fill in the form. If you merely ' +
            'read such a page, no connection to Google is made. For its assessment, reCAPTCHA ' +
            'evaluates your IP address, time spent on the page and mouse movements, among other ' +
            'things, and transmits this to Google.'
        },
        {
          type: 'p',
          text:
            'The legal basis is Art. 6(1)(f) GDPR; our legitimate interest lies in protection ' +
            'against spam and abuse. Data may also be transmitted to Google LLC servers in the USA, ' +
            'safeguarded by standard contractual clauses or the EU-U.S. Data Privacy Framework.'
        },
        {
          type: 'p',
          text:
            'For details see <a href="https://policies.google.com/privacy" target="_blank" rel="noopener noreferrer" ' +
            LINK +
            '>Google\'s privacy policy</a> and its <a href="https://policies.google.com/terms" target="_blank" rel="noopener noreferrer" ' +
            LINK +
            '>terms of service</a>.'
        }
      ]
    },
    {
      id: 'maps',
      heading: 'Google Maps',
      blocks: [
        {
          type: 'p',
          text:
            'On the training page we show the location of our training grounds using maps from ' +
            'Google Ireland Limited, Gordon House, Barrow Street, Dublin 4, Ireland.'
        },
        {
          type: 'p',
          text:
            'The maps are <strong>only loaded after you have given explicit consent</strong>. ' +
            'Without consent you see only a notice in their place and no connection to Google is ' +
            'made. Once a map loads, your IP address and details about your browser are transmitted ' +
            'to Google, possibly also to the USA.'
        },
        {
          type: 'p',
          text:
            'The legal basis is your consent under Art. 6(1)(a) GDPR and § 25(1) TDDDG. You can ' +
            'withdraw it at the top of this page at any time.'
        }
      ]
    },
    {
      id: 'empfaenger',
      heading: 'Recipients and processors',
      blocks: [
        {
          type: 'p',
          text:
            'We do not pass your data on for advertising purposes and we do not sell it. Only the ' +
            'following service providers, acting on our behalf, have access:'
        },
        {
          type: 'table',
          head: ['Service', 'Role', 'Place of processing'],
          rows: [
            ['Netlify, Inc. (USA)', 'Hosting and delivery of the website', 'USA / global CDN'],
            [
              'Supabase Inc. (USA)',
              'Database and server functions: delivers the fixtures and tables on the results ' +
                'pages, and receives the form submissions',
              'Data centre in Frankfurt am Main (eu-central-1)'
            ],
            ['Resend (USA)', 'Sending the notification emails', 'USA'],
            ['Google Ireland Limited', 'reCAPTCHA and — after consent — Google Maps', 'EU/USA']
          ]
        },
        {
          type: 'p',
          text:
            'We have data processing agreements under Art. 28 GDPR with these providers. Where data ' +
            'reaches the USA, we base the transfer on the European Commission\'s standard ' +
            'contractual clauses under Art. 46(2)(c) GDPR or on the EU-U.S. Data Privacy Framework. ' +
            'We point out that the USA does not offer a level of data protection equivalent to ' +
            'European law and that access by authorities there cannot be entirely ruled out.'
        }
      ]
    },
    {
      id: 'social-media',
      heading: 'Social media',
      blocks: [
        {
          type: 'p',
          text:
            'We link to our Instagram profile in the footer. This is an ordinary link, ' +
            '<strong>not an embedded plugin</strong>: no Instagram content is loaded and no data is ' +
            'transmitted to Meta when you merely open our page. Only when you click the link do you ' +
            'reach Instagram, where Meta\'s privacy terms then apply.'
        }
      ]
    },
    {
      id: 'sicherheit',
      heading: 'Security',
      blocks: [
        {
          type: 'p',
          text:
            'The website is served exclusively over encrypted HTTPS. Beyond that we take ' +
            'appropriate technical and organisational measures under Art. 32 GDPR to protect your ' +
            'data against loss, alteration and unauthorised access. Access to our club mailbox is ' +
            'limited to the responsible board members.'
        }
      ]
    },
    {
      id: 'rechte',
      heading: 'Your rights',
      blocks: [
        {
          type: 'p',
          text:
            'You have the following rights against us. An informal message to ' +
            '<a href="mailto:it&#64;nuernberg-renegades.de" ' +
            LINK +
            '>it&#64;nuernberg-renegades.de</a> is enough.'
        },
        {
          type: 'ul',
          items: [
            '<strong>Access (Art. 15 GDPR):</strong> you can find out whether and which data we process about you, and receive a copy.',
            '<strong>Rectification (Art. 16 GDPR):</strong> you can have inaccurate data corrected and incomplete data completed.',
            '<strong>Erasure (Art. 17 GDPR):</strong> you can request deletion of your data where we no longer need it and no retention obligation applies.',
            '<strong>Restriction (Art. 18 GDPR):</strong> you can require that we only store your data for the time being and no longer use it.',
            '<strong>Data portability (Art. 20 GDPR):</strong> you can receive the data you provided in a structured, commonly used, machine-readable format, or have it transmitted to another controller.',
            '<strong>Objection (Art. 21 GDPR):</strong> on grounds relating to your particular situation you may object at any time to processing we base on a legitimate interest.',
            '<strong>Withdrawal of consent (Art. 7(3) GDPR):</strong> you can withdraw consent at any time with effect for the future. This does not affect the lawfulness of processing carried out beforehand.'
          ]
        },
        { type: 'h3', text: 'Right to lodge a complaint' },
        {
          type: 'p',
          text:
            'You may lodge a complaint with a data protection supervisory authority at any time. ' +
            'The authority responsible for us is the Bavarian Data Protection Authority (BayLDA), ' +
            'Promenade 27, 91522 Ansbach, Germany, <a href="https://www.lda.bayern.de" target="_blank" rel="noopener noreferrer" ' +
            LINK +
            '>www.lda.bayern.de</a>. You may also contact the authority where you live or work.'
        }
      ]
    },
    {
      id: 'aenderungen',
      heading: 'Changes to this policy',
      blocks: [
        {
          type: 'p',
          text:
            'We update this privacy policy when the processing described here changes. The version ' +
            'published here is the one that applies; the date above shows its current status.'
        }
      ]
    }
  ]
};
