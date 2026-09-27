import type { PrivacyContent } from '../privacy-content.types';

const LINK = 'class="text-accent dark:text-[var(--brand-amber)] underline hover:text-accent-dark dark:hover:text-white"';

export const privacyContent: PrivacyContent = {
  title: 'Datenschutzerklärung',
  updated: 'Stand: 27. September 2026',
  tocHeading: 'Inhaltsübersicht',
  cookieSettingsIntro:
    'Hier können Sie Ihre Einwilligung jederzeit anpassen oder widerrufen. Die Änderung wirkt sofort und gilt für künftige Seitenaufrufe.',
  sections: [
    {
      id: 'verantwortlicher',
      heading: 'Verantwortlicher',
      blocks: [
        {
          type: 'p',
          text: 'Verantwortlich für die Datenverarbeitung auf dieser Website im Sinne der DSGVO ist:'
        },
        {
          type: 'p',
          text:
            'Nürnberg Renegades e.V.<br>Bartholomäusstr. 26c<br>90489 Nürnberg<br>' +
            'Vertreten durch: Andreas Scherm (1. Vorsitzender)<br>' +
            'Eingetragen im Vereinsregister Nürnberg, VR 202816'
        },
        {
          type: 'p',
          text:
            'E-Mail in Datenschutzangelegenheiten: <a href="mailto:it&#64;nuernberg-renegades.de" ' +
            LINK +
            '>it&#64;nuernberg-renegades.de</a><br>Allgemeiner Kontakt: <a href="mailto:info&#64;nuernberg-renegades.de" ' +
            LINK +
            '>info&#64;nuernberg-renegades.de</a>'
        },
        {
          type: 'p',
          text:
            'Einen Datenschutzbeauftragten haben wir nicht bestellt, da die gesetzlichen ' +
            'Voraussetzungen hierfür (Art. 37 DSGVO, § 38 BDSG) bei uns nicht vorliegen.'
        }
      ]
    },
    {
      id: 'ueberblick',
      heading: 'Was wir verarbeiten – im Überblick',
      blocks: [
        {
          type: 'p',
          text:
            'Diese Website ist bewusst datensparsam gebaut. Sie setzt keine Werbe- oder ' +
            'Tracking-Technologien ein, bindet keine Analysedienste ein und erstellt keine ' +
            'Nutzungsprofile. Schriftarten werden von unserem eigenen Server ausgeliefert, ' +
            'sodass beim bloßen Aufruf der Seite keine Verbindung zu Google entsteht.'
        },
        {
          type: 'p',
          text: 'Personenbezogene Daten entstehen im Wesentlichen an vier Stellen:'
        },
        {
          type: 'ul',
          items: [
            'beim Aufruf der Website (Server-Logdaten, insbesondere die IP-Adresse),',
            'beim Aufruf der Ergebnisseiten, weil Ihr Browser die Spieldaten aus unserer ' +
              'Datenbank bei Supabase in Frankfurt am Main abruft,',
            'wenn Sie eines unserer Formulare absenden (Kontakt, Probetraining, Mitgliedsantrag),',
            'wenn Sie in die Anzeige der Google-Maps-Karten auf der Trainingsseite einwilligen.'
          ]
        },
        { type: 'h3', text: 'Kategorien betroffener Personen' },
        {
          type: 'ul',
          items: [
            'Besucherinnen und Besucher dieser Website',
            'Personen, die uns über ein Formular kontaktieren',
            'Personen, die einen Mitgliedsantrag stellen'
          ]
        }
      ]
    },
    {
      id: 'rechtsgrundlagen',
      heading: 'Rechtsgrundlagen',
      blocks: [
        {
          type: 'p',
          text:
            'Wir verarbeiten personenbezogene Daten auf Grundlage der folgenden Vorschriften. ' +
            'Welche im Einzelfall gilt, nennen wir jeweils bei der betreffenden Verarbeitung.'
        },
        {
          type: 'ul',
          items: [
            '<strong>Art. 6 Abs. 1 lit. a DSGVO – Einwilligung:</strong> für Google Maps und für das Speichern Ihrer Sprach- und Design-Einstellungen. Ergänzend gilt § 25 Abs. 1 TDDDG für das Speichern und Auslesen von Informationen auf Ihrem Endgerät.',
            '<strong>Art. 6 Abs. 1 lit. b DSGVO – Vertrag und vorvertragliche Maßnahmen:</strong> für die Bearbeitung von Mitgliedsanträgen und Anfragen zum Probetraining.',
            '<strong>Art. 6 Abs. 1 lit. f DSGVO – berechtigte Interessen:</strong> für den technisch sicheren Betrieb der Website, die Abwehr von Spam und automatisierten Angriffen sowie die Beantwortung allgemeiner Kontaktanfragen.',
            '<strong>§ 25 Abs. 2 Nr. 2 TDDDG:</strong> für technisch unbedingt erforderliche Speichervorgänge, etwa das Sichern Ihrer Cookie-Entscheidung.'
          ]
        }
      ]
    },
    {
      id: 'hosting',
      heading: 'Hosting und Server-Logdaten',
      blocks: [
        {
          type: 'p',
          text:
            'Diese Website wird bei der Netlify, Inc., 512 2nd Street, Suite 200, San Francisco, ' +
            'CA 94107, USA, gehostet. Netlify verarbeitet die Daten in unserem Auftrag auf Grundlage ' +
            'eines Auftragsverarbeitungsvertrags nach Art. 28 DSGVO.'
        },
        {
          type: 'p',
          text:
            'Beim Aufruf einer Seite überträgt Ihr Browser technisch notwendige Daten, die in ' +
            'Server-Logdateien verarbeitet werden: IP-Adresse, Datum und Uhrzeit des Zugriffs, ' +
            'die aufgerufene Adresse, den Referrer sowie Browser- und Betriebssystemkennung. ' +
            'Ohne die IP-Adresse könnten wir Ihnen die Seite technisch nicht ausliefern.'
        },
        {
          type: 'p',
          text:
            'Rechtsgrundlage ist Art. 6 Abs. 1 lit. f DSGVO. Unser berechtigtes Interesse liegt ' +
            'in der stabilen, sicheren Bereitstellung der Website. Wir selbst werten diese ' +
            'Logdaten nicht aus und führen sie nicht mit anderen Daten zusammen.'
        },
        {
          type: 'p',
          text:
            'Da Netlify ein US-Unternehmen ist, kann es zu einer Übermittlung in die USA kommen. ' +
            'Diese ist durch Standardvertragsklauseln der EU-Kommission bzw. – soweit der Anbieter ' +
            'zertifiziert ist – durch das EU-U.S. Data Privacy Framework abgesichert.'
        }
      ]
    },
    {
      id: 'schriftarten',
      heading: 'Schriftarten',
      blocks: [
        {
          type: 'p',
          text:
            'Wir verwenden die Schriftarten „Manrope" und „Sora". Beide werden ausschließlich ' +
            'von unserem eigenen Server ausgeliefert. Es besteht dabei <strong>keine Verbindung ' +
            'zu Google Fonts oder einem anderen Drittanbieter</strong>, und Ihre IP-Adresse wird ' +
            'zu diesem Zweck an niemanden übermittelt.'
        }
      ]
    },
    {
      id: 'cookies',
      heading: 'Cookies und lokale Speicherung',
      blocks: [
        {
          type: 'p',
          text:
            'Wir setzen keine Werbe- oder Tracking-Cookies ein. Gespeichert wird nur das ' +
            'Folgende, jeweils lokal in Ihrem Browser (localStorage und ein gleichnamiges Cookie):'
        },
        {
          type: 'table',
          head: ['Bezeichnung', 'Zweck', 'Rechtsgrundlage', 'Speicherdauer'],
          rows: [
            [
              'cookie-consent',
              'Speichert Ihre Entscheidung im Cookie-Banner, damit wir nicht bei jedem Aufruf erneut fragen.',
              '§ 25 Abs. 2 Nr. 2 TDDDG (unbedingt erforderlich)',
              'Bis Sie den Browserspeicher löschen'
            ],
            [
              'preferredLanguage',
              'Merkt sich, ob Sie die Seite auf Deutsch oder Englisch lesen möchten.',
              'Einwilligung (Kategorie „Präferenzen")',
              'Bis Sie den Browserspeicher löschen'
            ],
            [
              'preferredTheme',
              'Merkt sich, ob Sie das helle oder dunkle Design bevorzugen.',
              'Einwilligung (Kategorie „Präferenzen")',
              'Bis Sie den Browserspeicher löschen'
            ]
          ]
        },
        {
          type: 'p',
          text:
            'Diese Einträge verfallen nicht automatisch. Sie können sie jederzeit über die ' +
            'Einstellungen Ihres Browsers löschen; die Website funktioniert danach unverändert, ' +
            'merkt sich Ihre Auswahl aber nicht mehr.'
        },
        { type: 'h3', text: 'Ihre Einwilligung' },
        {
          type: 'p',
          text:
            'Beim ersten Besuch fragen wir Sie, ob Sie über die technisch notwendigen Funktionen ' +
            'hinaus einwilligen möchten. Es ist nichts vorausgewählt: Ohne Ihre aktive Zustimmung ' +
            'werden weder Präferenzen gespeichert noch Karten geladen. Ihre Einwilligung können Sie ' +
            'oben auf dieser Seite jederzeit mit Wirkung für die Zukunft ändern oder widerrufen.'
        }
      ]
    },
    {
      id: 'ergebnisse',
      heading: 'Ergebnisse, Tabellen und Live-Ticker',
      blocks: [
        {
          type: 'p',
          text:
            'Auf den Ergebnisseiten zeigen wir Spielpläne, Ergebnisse und Tabellen unserer ' +
            'beiden Mannschaften. Diese Daten liegen in unserer eigenen Datenbank bei Supabase ' +
            'im Rechenzentrum Frankfurt am Main. Wenn Sie eine Ergebnisseite aufrufen, ruft Ihr ' +
            'Browser sie dort ab – dabei wird, wie bei jedem Seitenaufruf, Ihre IP-Adresse ' +
            'übertragen. Beim Live-Ticker besteht zusätzlich eine offene Verbindung zu dieser ' +
            'Datenbank, solange Sie die Seite geöffnet haben, damit sich der Spielstand ohne ' +
            'Neuladen aktualisiert.'
        },
        {
          type: 'p',
          text:
            'Rechtsgrundlage ist unser berechtigtes Interesse nach Art. 6 Abs. 1 lit. f DSGVO, ' +
            'die Ergebnisse unserer Mannschaften aktuell darzustellen. Es werden dabei keine ' +
            'Cookies gesetzt und kein Nutzungsverhalten ausgewertet.'
        },
        {
          type: 'p',
          text:
            'Die Spieldaten selbst stammen von LeagueSphere, der Spielplattform unseres ' +
            'Verbandes. Diese Daten holt ausschließlich ein Serverdienst von uns in ' +
            'regelmäßigen Abständen ab. Ihr Browser nimmt zu LeagueSphere zu keinem Zeitpunkt ' +
            'Kontakt auf, und es werden keine Daten über Sie dorthin übermittelt.'
        },
        {
          type: 'p',
          text:
            'Bis September 2026 war an dieser Stelle eine Anzeige eines externen Anbieters ' +
            'eingebunden (GitHub Pages, USA). Diese Einbindung haben wir entfernt; beim Aufruf ' +
            'der Ergebnisseiten wird seitdem kein Drittanbieter mehr kontaktiert.'
        }
      ]
    },
    {
      id: 'formulare',
      heading: 'Unsere Formulare',
      blocks: [
        {
          type: 'p',
          text:
            'Alle drei Formulare funktionieren nach demselben Prinzip: Ihre Eingaben werden an eine ' +
            'Serverfunktion bei Supabase übergeben, die daraus eine E-Mail erzeugt und über den ' +
            'Dienstleister Resend an unser Vereinspostfach sendet. <strong>Eine Speicherung in einer ' +
            'Datenbank findet nicht statt</strong> – die Daten existieren anschließend nur als ' +
            'E-Mail in unserem Postfach.'
        },
        { type: 'h3', text: 'Kontaktformular' },
        {
          type: 'p',
          text:
            'Verarbeitet werden Name, E-Mail-Adresse, Betreff und Ihre Nachricht. Rechtsgrundlage ' +
            'ist Art. 6 Abs. 1 lit. f DSGVO (berechtigtes Interesse an der Beantwortung Ihrer ' +
            'Anfrage); zielt Ihre Anfrage auf einen Vertrag ab, ist es Art. 6 Abs. 1 lit. b DSGVO.'
        },
        { type: 'h3', text: 'Anfrage zum Probetraining' },
        {
          type: 'p',
          text:
            'Verarbeitet werden Name und E-Mail-Adresse sowie – falls Sie sie angeben – Telefonnummer, ' +
            'Alter, Vorerfahrung und Ihre Nachricht. Rechtsgrundlage ist Art. 6 Abs. 1 lit. b DSGVO ' +
            '(vorvertragliche Maßnahme).'
        },
        { type: 'h3', text: 'Mitgliedsantrag' },
        {
          type: 'p',
          text:
            'Für die Aufnahme in den Verein benötigen wir Vor- und Nachname, Geburtsdatum, Geburtsort, ' +
            'Anschrift, E-Mail-Adresse und den gewünschten Eintrittstermin. Freiwillig sind Beruf, ' +
            'Staatsangehörigkeit sowie Telefon-, Mobil- und Faxnummer.'
        },
        {
          type: 'p',
          text:
            'Wenn Sie uns ein SEPA-Lastschriftmandat erteilen möchten, verarbeiten wir zusätzlich ' +
            '<strong>Kontoinhaber, IBAN, BIC und Bankname</strong>. Diese Angaben sind freiwillig; ' +
            'ohne sie ist eine Mitgliedschaft möglich, der Beitrag muss dann aber anders beglichen ' +
            'werden. Die Zahlungsdaten verwenden wir ausschließlich zum Einzug des Mitgliedsbeitrags.'
        },
        {
          type: 'p',
          text:
            'Aus Ihren Angaben erzeugen wir automatisch ein ausgefülltes PDF des Aufnahmeantrags, ' +
            'das der Benachrichtigungs-E-Mail beigefügt wird. Rechtsgrundlage ist Art. 6 Abs. 1 ' +
            'lit. b DSGVO (Begründung und Durchführung des Mitgliedschaftsverhältnisses).'
        },
        { type: 'h3', text: 'Wie lange wir die Daten aufbewahren' },
        {
          type: 'p',
          text:
            'Anfragen über das Kontakt- und das Probetrainingsformular löschen wir, sobald sie ' +
            'abschließend bearbeitet sind und keine Rückfragen mehr zu erwarten sind. Daten aus ' +
            'einem Mitgliedsantrag bewahren wir für die Dauer der Mitgliedschaft auf. Gesetzliche ' +
            'Aufbewahrungsfristen – insbesondere die handels- und steuerrechtlichen Fristen von ' +
            'sechs bzw. zehn Jahren nach § 257 HGB und § 147 AO – bleiben unberührt; für diese ' +
            'Dauer wird die Verarbeitung eingeschränkt statt gelöscht.'
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
            'Um unsere Formulare vor automatisierten Einsendungen zu schützen, setzen wir ' +
            'reCAPTCHA v3 der Google Ireland Limited, Gordon House, Barrow Street, Dublin 4, ' +
            'Irland, ein.'
        },
        {
          type: 'p',
          text:
            'reCAPTCHA wird <strong>nicht auf allen Seiten</strong> geladen, sondern nur auf den ' +
            'Seiten mit einem Formular – und dort erst, sobald Sie das Formular tatsächlich ' +
            'anklicken oder ausfüllen. Wer eine solche Seite nur liest, baut keine Verbindung zu ' +
            'Google auf. Zur Bewertung wertet reCAPTCHA unter anderem Ihre IP-Adresse, die ' +
            'Verweildauer und Mausbewegungen aus und übermittelt diese Angaben an Google.'
        },
        {
          type: 'p',
          text:
            'Rechtsgrundlage ist Art. 6 Abs. 1 lit. f DSGVO; unser berechtigtes Interesse liegt ' +
            'im Schutz vor Spam und Missbrauch. Dabei können Daten auch an Server von Google LLC ' +
            'in den USA übermittelt werden, abgesichert über Standardvertragsklauseln bzw. das ' +
            'EU-U.S. Data Privacy Framework.'
        },
        {
          type: 'p',
          text:
            'Näheres finden Sie in der <a href="https://policies.google.com/privacy" target="_blank" rel="noopener noreferrer" ' +
            LINK +
            '>Datenschutzerklärung von Google</a> und in den <a href="https://policies.google.com/terms" target="_blank" rel="noopener noreferrer" ' +
            LINK +
            '>Nutzungsbedingungen</a>.'
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
            'Auf der Trainingsseite zeigen wir die Lage unserer Trainingsstätten über Karten der ' +
            'Google Ireland Limited, Gordon House, Barrow Street, Dublin 4, Irland.'
        },
        {
          type: 'p',
          text:
            'Die Karten werden <strong>erst geladen, nachdem Sie ausdrücklich eingewilligt haben</strong>. ' +
            'Ohne Einwilligung sehen Sie an dieser Stelle lediglich einen Hinweis; es wird keine ' +
            'Verbindung zu Google hergestellt. Mit dem Laden der Karte werden Ihre IP-Adresse und ' +
            'Angaben zu Ihrem Browser an Google übertragen, möglicherweise auch in die USA.'
        },
        {
          type: 'p',
          text:
            'Rechtsgrundlage ist Ihre Einwilligung nach Art. 6 Abs. 1 lit. a DSGVO und ' +
            '§ 25 Abs. 1 TDDDG. Sie können sie oben auf dieser Seite jederzeit widerrufen.'
        }
      ]
    },
    {
      id: 'empfaenger',
      heading: 'Empfänger und Auftragsverarbeiter',
      blocks: [
        {
          type: 'p',
          text:
            'Wir geben Ihre Daten nicht zu Werbezwecken weiter und verkaufen sie nicht. ' +
            'Zugriff haben ausschließlich die folgenden Dienstleister, die für uns tätig werden:'
        },
        {
          type: 'table',
          head: ['Dienst', 'Aufgabe', 'Ort der Verarbeitung'],
          rows: [
            ['Netlify, Inc. (USA)', 'Hosting und Auslieferung der Website', 'USA / weltweites CDN'],
            [
              'Supabase Inc. (USA)',
              'Datenbank und Serverfunktionen: liefert die Spiel- und Tabellendaten der ' +
                'Ergebnisseiten aus und nimmt die Formulareingaben entgegen',
              'Rechenzentrum in Frankfurt am Main (eu-central-1)'
            ],
            ['Resend (USA)', 'Versand der Benachrichtigungs-E-Mails', 'USA'],
            ['Google Ireland Limited', 'reCAPTCHA und – nach Einwilligung – Google Maps', 'EU/USA']
          ]
        },
        {
          type: 'p',
          text:
            'Mit diesen Anbietern bestehen Verträge zur Auftragsverarbeitung nach Art. 28 DSGVO. ' +
            'Soweit Daten in die USA gelangen, stützen wir die Übermittlung auf Standardvertrags-' +
            'klauseln der EU-Kommission nach Art. 46 Abs. 2 lit. c DSGVO bzw. auf das ' +
            'EU-U.S. Data Privacy Framework. Wir weisen darauf hin, dass in den USA kein dem ' +
            'europäischen Recht gleichwertiges Datenschutzniveau besteht und insbesondere ein ' +
            'Zugriff durch dortige Behörden nicht vollständig ausgeschlossen werden kann.'
        }
      ]
    },
    {
      id: 'social-media',
      heading: 'Social Media',
      blocks: [
        {
          type: 'p',
          text:
            'Im Fußbereich verlinken wir unser Instagram-Profil. Dabei handelt es sich um einen ' +
            'gewöhnlichen Link, <strong>nicht um ein eingebettetes Plugin</strong>: Es werden keine ' +
            'Inhalte von Instagram nachgeladen und beim bloßen Aufruf unserer Seite keine Daten an ' +
            'Meta übertragen. Erst wenn Sie den Link anklicken, gelangen Sie zu Instagram, wo dann ' +
            'die Datenschutzbestimmungen von Meta gelten.'
        }
      ]
    },
    {
      id: 'sicherheit',
      heading: 'Sicherheit',
      blocks: [
        {
          type: 'p',
          text:
            'Die Website wird ausschließlich verschlüsselt über HTTPS ausgeliefert. Darüber hinaus ' +
            'treffen wir nach Art. 32 DSGVO angemessene technische und organisatorische Maßnahmen, ' +
            'um Ihre Daten gegen Verlust, Veränderung und unbefugten Zugriff zu schützen. Der Kreis ' +
            'der Personen mit Zugriff auf unser Vereinspostfach ist auf die zuständigen ' +
            'Vorstandsmitglieder beschränkt.'
        }
      ]
    },
    {
      id: 'rechte',
      heading: 'Ihre Rechte',
      blocks: [
        {
          type: 'p',
          text:
            'Ihnen stehen gegenüber uns die folgenden Rechte zu. Eine formlose Nachricht an ' +
            '<a href="mailto:it&#64;nuernberg-renegades.de" ' +
            LINK +
            '>it&#64;nuernberg-renegades.de</a> genügt.'
        },
        {
          type: 'ul',
          items: [
            '<strong>Auskunft (Art. 15 DSGVO):</strong> Sie können erfahren, ob und welche Daten wir über Sie verarbeiten, und eine Kopie davon erhalten.',
            '<strong>Berichtigung (Art. 16 DSGVO):</strong> Sie können unrichtige Daten korrigieren und unvollständige vervollständigen lassen.',
            '<strong>Löschung (Art. 17 DSGVO):</strong> Sie können die Löschung Ihrer Daten verlangen, soweit wir sie nicht mehr benötigen und keine Aufbewahrungspflicht besteht.',
            '<strong>Einschränkung (Art. 18 DSGVO):</strong> Sie können verlangen, dass wir Ihre Daten vorerst nur noch speichern, aber nicht weiter verwenden.',
            '<strong>Datenübertragbarkeit (Art. 20 DSGVO):</strong> Sie können die von Ihnen bereitgestellten Daten in einem strukturierten, gängigen und maschinenlesbaren Format erhalten oder deren Übermittlung an einen anderen Verantwortlichen verlangen.',
            '<strong>Widerspruch (Art. 21 DSGVO):</strong> Sie können aus Gründen, die sich aus Ihrer besonderen Situation ergeben, jederzeit der Verarbeitung widersprechen, die wir auf ein berechtigtes Interesse stützen.',
            '<strong>Widerruf der Einwilligung (Art. 7 Abs. 3 DSGVO):</strong> Sie können eine erteilte Einwilligung jederzeit mit Wirkung für die Zukunft widerrufen. Die Rechtmäßigkeit der bis dahin erfolgten Verarbeitung bleibt davon unberührt.'
          ]
        },
        { type: 'h3', text: 'Beschwerderecht' },
        {
          type: 'p',
          text:
            'Sie können sich jederzeit bei einer Datenschutz-Aufsichtsbehörde beschweren. Für uns ' +
            'zuständig ist das Bayerische Landesamt für Datenschutzaufsicht (BayLDA), Promenade 27, ' +
            '91522 Ansbach, <a href="https://www.lda.bayern.de" target="_blank" rel="noopener noreferrer" ' +
            LINK +
            '>www.lda.bayern.de</a>. Sie können sich auch an die Behörde Ihres Wohnorts oder ' +
            'Arbeitsplatzes wenden.'
        }
      ]
    },
    {
      id: 'aenderungen',
      heading: 'Änderungen dieser Erklärung',
      blocks: [
        {
          type: 'p',
          text:
            'Wir passen diese Datenschutzerklärung an, wenn sich die beschriebenen Verarbeitungen ' +
            'ändern. Es gilt jeweils die hier veröffentlichte Fassung; das Datum oben zeigt den ' +
            'aktuellen Stand.'
        }
      ]
    }
  ]
};
