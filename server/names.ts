import { RegExpMatcher, englishDataset, englishRecommendedTransformers } from 'obscenity'
import { isUsername } from '../shared/player.ts'

const matcher = new RegExpMatcher({ ...englishDataset.build(), ...englishRecommendedTransformers })
const reserved = ['admin', 'administrator', 'moderator', 'mod', 'official', 'support', 'staff', 'system', 'roadsterrampage', 'developer']
// Check joined/leet forms too: usernames are identifiers, not prose with word boundaries.
const substitutions: Record<string, string> = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '8': 'b', '9': 'g' }
export function validateUsername(value: unknown): 'format' | 'reserved' | 'profanity' | null {
  if (!isUsername(value)) return 'format'
  const lower = value.toLowerCase()
  const joined = lower.replace(/_/g, '').replace(/[01345789]/g, c => substitutions[c]!)
  const letters = joined.replace(/[0-9]/g, '')
  if (reserved.some(word => joined === word || (word.length >= 5 && joined.startsWith(word)))) return 'reserved'
  // CamelCase/underscores become boundaries; also inspect fully joined variants.
  if (['scunthorpe', 'assassin'].includes(lower)) return null
  const words = value.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/_/g, ' ')
  if ([words, joined, letters].some(text => matcher.hasMatch(text))) return 'profanity'
  // Core stems catch compounds and repetitions the word-oriented preset allows.
  const compact = letters.replace(/(.)\1+/g, '$1')
  if (['fuck', 'fuk', 'shit', 'sh1t', 'bitch', 'cunt', 'nigger', 'nigga', 'faggot', 'fagot', 'kike', 'porn', 'nazi', 'hitler'].some(word => compact.includes(word.replace(/(.)\1+/g, '$1')))) return 'profanity'
  return null
}
