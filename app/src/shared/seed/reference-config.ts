import type { ConfigInput } from "../config/schema.ts";

/**
 * The reference Deployment's configuration: SPEC Appendix A, authored in Hungarian (SPEC 2.5).
 * Sample data for the demonstration Deployment, not part of the design. The `seed` command writes it into
 * local KV; tests and the end-to-end suite read it back from there. Another Deployment defines its own.
 *
 * Email templates use these placeholders (ticket #26 may extend them):
 *   otp                      {code} {minutes}
 *   submissionConfirmation   {number} {title} {link}
 *   closed                   {number} {title} {reason} {link}
 *   reopened                 {number} {title} {link}
 *   statusEntered            {number} {title} {status} {link}
 *   linkReissued             {number} {title} {link}
 * and the footer takes {reply} (SPEC 4.6). Every Report subject is `Bejelentés #{number} — „{title}” — …`.
 */
export const referenceConfig = {
  language: "hu",
  timezone: "Europe/Budapest",
  displayName: "Rózsa Társasház",
  emergencyNotice:
    "Tűz, gázszivárgás vagy vízbetörés esetén ne hibabejelentést töltsön ki, hanem hívja a 112-es segélyhívó számot.",
  codeSentHelp:
    "Ha a cím szerepel a bejelentők listáján, a kód néhány percen belül megérkezik. Nézze meg a levélszemét mappát is. Ha így sem kapja meg, forduljon a gondnokhoz: lehet, hogy a címe még nincs felvéve, vagy elírta.",
  taxonomy: {
    category: [
      { id: "electrical", name: "Elektromos hiba", color: "fbca04" },
      { id: "plumbing", name: "Víz- és csatornahiba", color: "0075ca" },
      { id: "heating-cooling", name: "Fűtés és hűtés", color: "d93f0b" },
      { id: "elevator", name: "Lift", color: "7057ff" },
      { id: "structural", name: "Szerkezeti hiba (fal, tető, padló)", color: "8b6f47" },
      { id: "doors-windows", name: "Ajtók és ablakok", color: "a2eeef" },
      { id: "common-areas", name: "Közös területek (takarítás, világítás, hulladék)", color: "008672" },
      { id: "safety", name: "Biztonság (tűz, riasztó, veszélyforrás)", color: "d73a4a" },
      { id: "other", name: "Egyéb", color: "cfd3d7" },
    ],
    location: [
      { id: "basement", name: "Pince", color: "ededed" },
      { id: "ground-floor", name: "Földszint", color: "ededed" },
      { id: "floor-1", name: "1. emelet", color: "ededed" },
      { id: "floor-2", name: "2. emelet", color: "ededed" },
      { id: "floor-3", name: "3. emelet", color: "ededed" },
      { id: "stairwell", name: "Lépcsőház", color: "ededed" },
      { id: "elevator", name: "Lift", color: "ededed" },
      { id: "roof", name: "Tető", color: "ededed" },
      { id: "courtyard", name: "Udvar", color: "ededed" },
      { id: "garage", name: "Garázs", color: "ededed" },
      { id: "outdoor-other", name: "Egyéb kültéri terület", color: "ededed" },
    ],
    priority: [
      { id: "low", name: "Alacsony", color: "c2e0c6" },
      { id: "normal", name: "Normál", color: "fef2c0" },
      { id: "high", name: "Magas", color: "f9a03f" },
      { id: "urgent", name: "Sürgős", color: "d73a4a" },
    ],
    status: [
      { id: "new", name: "Új", color: "1d76db", initial: true },
      { id: "in-progress", name: "Folyamatban", color: "fbca04", notify: true },
      { id: "on-hold", name: "Várakozik", color: "cfd3d7", notify: true },
    ],
  },
  email: {
    senderLocalPart: "reports",
    senderName: "Rózsa Társasház",
    // A placeholder mailbox for local development. The real reply-to is entered on the Configuration screen.
    replyTo: "gondnok@example.org",
    replyClause: "válaszoljon erre a levélre, ha a gondnokot szeretné elérni",
    footer: "Automatikus üzenet a Rózsa Társasház hibabejelentő rendszeréből — {reply}",
    templates: {
      otp: {
        subject: "Ellenőrző kód a hibabejelentéshez",
        body: "Az ellenőrző kódja: {code}\n\nA kód {minutes} percig érvényes, és a hibabejelentés beküldéséhez kell.\n\nHa nem ön kérte ezt a kódot, hagyja figyelmen kívül ezt a levelet.",
      },
      submissionConfirmation: {
        subject: "Bejelentés #{number} — „{title}” — beérkezett",
        body: "Megkaptuk a bejelentését.\n\nSorszám: #{number}\nCím: {title}\n\nA bejelentés állapotát és előzményeit ezen a hivatkozáson követheti, és itt fűzhet hozzá megjegyzést is:\n{link}\n\nŐrizze meg ezt a levelet: a hivatkozás az egyetlen módja a bejelentés követésének.",
      },
      closed: {
        subject: "Bejelentés #{number} — „{title}” — lezárva",
        body: "A(z) #{number} számú bejelentését lezártuk.\n\nCím: {title}\nIndok: {reason}\n\nA részletek és az előzmények itt érhetők el:\n{link}",
      },
      reopened: {
        subject: "Bejelentés #{number} — „{title}” — újranyitva",
        body: "A(z) #{number} számú bejelentését újra megnyitottuk.\n\nCím: {title}\n\nAz aktuális állapot itt követhető:\n{link}",
      },
      statusEntered: {
        subject: "Bejelentés #{number} — „{title}” — új állapot: {status}",
        body: "A(z) #{number} számú bejelentés új állapota: {status}\n\nCím: {title}\n\nA részletek itt érhetők el:\n{link}",
      },
      linkReissued: {
        subject: "Bejelentés #{number} — „{title}” — új hivatkozás",
        body: "A(z) #{number} számú bejelentés korábbi hivatkozása megszűnt, mindenki számára érvénytelen.\n\nCím: {title}\n\nAz új hivatkozás:\n{link}",
      },
    },
  },
  dailyCodeBudget: 40,
} as const satisfies ConfigInput;
