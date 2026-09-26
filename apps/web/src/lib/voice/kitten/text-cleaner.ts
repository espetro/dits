/**
 * TextCleaner: maps phoneme strings to token id sequences.
 * Port of KittenTTS text_cleaner (kitten-tts-js src/text-cleaner.js).
 * 178 symbols total: pad "$", 16 punctuation, 52 letters, 109 ipa chars.
 */

const PAD = "$";
const PUNCTUATION = ';:,.!?¡¿—…"«»"" ';
const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const LETTERS_IPA =
  "ɑɐɒæɓʙβɔɕçɗɖðʤəɘɚɛɜɝɞɟʄɡɠɢʛɦɧħɥʜɨɪʝɭɬɫɮʟɱɯɰŋɳɲɴøɵɸθœɶʘɹɺɾɻʀʁɽʂʃʈʧʉʊʋⱱʌɣɤʍχʎʏʑʐʒʔʡʕʢǀǁǂǃˈˌːˑʼʴʰʱʲʷˠˤ˞↓↑→↗↘'̩'ᵻ";

export const SYMBOLS = [PAD, ...PUNCTUATION, ...LETTERS, ...LETTERS_IPA];

const SYMBOL_TO_ID = new Map<string, number>();
SYMBOLS.forEach((s, i) => SYMBOL_TO_ID.set(s, i));

/** Python `re.findall(r"\w+|[^\w\s]")` — unicode-aware word/punct split. */
export function basicEnglishTokenize(text: string): string[] {
  const re = /[\p{L}\p{M}\p{N}_]+|[^\p{L}\p{M}\p{N}_\s]/gu;
  return text.match(re) ?? [];
}

/** Unicode code points → token ids; unknown chars are dropped. */
export function textToIds(text: string): number[] {
  const ids: number[] = [];
  for (const ch of text) {
    const id = SYMBOL_TO_ID.get(ch);
    if (id !== undefined) ids.push(id);
  }
  return ids;
}

/** phoneme string → model input ids, padded [0, …ids, 10, 0]. */
export function cleanText(phonemes: string): number[] {
  return [0, ...textToIds(phonemes), 10, 0];
}
