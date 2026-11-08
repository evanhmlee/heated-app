import 'server-only'

// Lightweight, deterministic, zero-cost moderation for debate submissions.
//
// TWO severity tiers, because they warrant very different treatment:
//   - SLURS (racial / homophobic / transphobic / ableist hate terms): zero
//     tolerance. In ranked play a slur is an instant automatic loss, no
//     warnings, every time (see the round route).
//   - PROFANITY (ordinary crude language): graduated within a single debate.
//     A first slip is a warning (the turn is redacted, which is its own cost),
//     a second costs points, a third is an automatic loss.
//
// This is a v1 hand-maintained blocklist with light obfuscation normalization
// (enough to catch "f-u-c-k" / "sh1t" / "a$$hole"). It is fast, free, and
// deterministic, but it misses creative evasion and can false-positive. Swap in
// a model / Moderation-API pass later if that becomes a problem.

// Common leetspeak / separator substitutions collapsed before matching. Keep
// this in sync with the word lists below.
const LEET: Record<string, string> = {
  '@': 'a',
  $: 's',
  '0': 'o',
  '1': 'i',
  '3': 'e',
  '4': 'a',
  '5': 's',
  '7': 't',
}

// Leetspeak is only decoded inside a word that already has a letter in it
// ("sh1t", "a$$", "f4g"). A bare number is a stat, and decoding it is how
// "he scored 455 points" used to read as "he scored ass points" and redact a
// clean turn (then cost points, then the match) in a basketball app where
// half of every argument is numbers. Bare numbers fall to the strip below.
function decodeLeet(word: string): string {
  return /[a-z]/.test(word) ? word.replace(/[@$013457]/g, (c) => LEET[c]) : word
}

function normalize(text: string): string {
  return text
    .toLowerCase()
    .split(/\s+/)
    .map(decodeLeet)
    .join(' ')
    // Drop anything that isn't a letter or space so "f.u.c.k" -> "fuck".
    .replace(/[^a-z\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

// ── Tier 1: SLURS (zero tolerance) ────────────────────────────────
// Hate / identity slurs. Substring terms catch compounds and plurals, so a
// term only belongs here if no ordinary English word contains it.
const SLUR_SUBSTRING = [
  'faggot',
  'tranny',
  'retard',
  'nigger',
  'nigga',
  'kike',
  'wetback',
]
// Needs whole-word matching to avoid innocent substrings.
//
// 'spic' and 'chink' were substring terms until 2026-09-02, which made this
// list fire on ordinary basketball English: "that stat line is SUSPICIOUS",
// "his CONSPICUOUS absence", "that trade was DESPICABLE", and the stock
// commentary idiom "a CHINK in their armor". Every one of those was scored as
// hate speech, which in ranked play is an instant loss, minus 100 points, a
// spent ticket and an on-screen accusation the user cannot appeal. Anything
// added here in future gets the same treatment unless it is a coinage no
// English word contains.
const SLUR_WORD = ['fag', 'spic', 'chink']

// Phrases stripped BEFORE slur matching, because the whole phrase is ordinary
// English and the bare word inside it is not.
//
// "a chink in the armor" is stock basketball commentary and survives word
// boundaries, so boundaries alone do not save it. The phrase is not innocent
// everywhere (ESPN fired a writer over it in 2012), but the cost of being wrong
// here is asymmetric: a false positive is an unappealable ranked loss for
// saying a normal sentence about defense, while a false negative is one crude
// turn that the graduated ladder still catches if it repeats.
const SLUR_ALLOW_PHRASES = [
  /\bchinks?\s+in\s+(the|their|his|her|its|our|your)\s+armou?r\b/g,
]

function stripAllowedPhrases(normalized: string): string {
  return SLUR_ALLOW_PHRASES.reduce((s, re) => s.replace(re, ' '), normalized)
}
const SLUR_WORD_PATTERN = new RegExp(`\\b(${SLUR_WORD.join('|')})\\b`, 'i')

// ── Tier 2: PROFANITY (graduated) ─────────────────────────────────
// Ordinary crude language. Substring terms catch compounds like "bullshit",
// "shitty", "fucking", "dumbass", "motherfucker".
const PROFANITY_SUBSTRING = [
  'fuck',
  'shit',
  'bitch',
  'cunt',
  'slut',
  'whore',
  'asshole',
  'dumbass',
  'jackass',
  'bastard',
]
// Whole-word to avoid innocent hosts ("class"/"pass" for "ass", "Dickerson").
const PROFANITY_WORD = ['ass', 'dick']
const PROFANITY_WORD_PATTERN = new RegExp(`\\b(${PROFANITY_WORD.join('|')})\\b`, 'i')

// Basketball names that contain a whole-word profanity term. "Dick Vitale" is
// the most quoted voice in the sport, and Dick Barnett, Dick Van Arsdale, Dick
// Motta and Dick Bavetta all come up in history arguments, so a bare word match
// redacted a clean turn for naming them. Stripped before profanity matching
// only, the same way SLUR_ALLOW_PHRASES works for slurs.
const PROFANITY_ALLOW_PHRASES = [
  /\bdick\s+(vitale|barnett|van\s+arsdale|motta|bavetta|versace|harter|stockton|mcguire|garmaker)\b/g,
]

export type ModerationSeverity = 'clean' | 'profanity' | 'slur'

// Classify a submission by its worst offense. Slurs outrank profanity, so a
// message containing both is a slur.
export function classify(text: string): ModerationSeverity {
  const normalized = normalize(text)
  // Each tier matches against its own allow-stripped copy, so a phrase allowed
  // for one tier can never hide an offense from the other.
  const forSlurs = stripAllowedPhrases(normalized)
  if (SLUR_SUBSTRING.some((t) => forSlurs.includes(t)) || SLUR_WORD_PATTERN.test(forSlurs)) {
    return 'slur'
  }
  const forProfanity = PROFANITY_ALLOW_PHRASES.reduce((t, re) => t.replace(re, ' '), normalized)
  if (
    PROFANITY_SUBSTRING.some((t) => forProfanity.includes(t)) ||
    PROFANITY_WORD_PATTERN.test(forProfanity)
  ) {
    return 'profanity'
  }
  return 'clean'
}

// Back-compat boolean check (e.g. the daily-take lane, which just rejects a
// flagged submission with no graduated ladder).
export function isInappropriate(text: string): boolean {
  return classify(text) !== 'clean'
}
