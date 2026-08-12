/**
 * The load-bearing assertion in this file is the *trailer* one, not the code
 * one. If `displayText` ever starts keeping unknown fenced blocks, the coding
 * track's `drill-log` verdict reaches the browser mid-drill and hands him the
 * answer. Several tests below therefore assert on what is absent.
 */

import { describe, expect, it } from 'vitest'
import { displayText, hasCodeBlock, isCodeTag, speechText } from './reply-code'

const CODE = '```ts\nconst a = 1\n```'

describe('isCodeTag', () => {
  it.each(['ts', 'tsx', 'js', 'jsx', 'typescript', 'javascript', ''])('accepts %o', (tag) => {
    expect(isCodeTag(tag)).toBe(true)
  })

  it.each(['drill-log', 'story-log', 'sh', 'python', 'yaml'])('rejects %o', (tag) => {
    expect(isCodeTag(tag)).toBe(false)
  })

  it('is case- and whitespace-insensitive, because a model is neither', () => {
    expect(isCodeTag(' TS ')).toBe(true)
  })
})

describe('displayText — code survives', () => {
  it('keeps a code block whole, fence and tag included', () => {
    expect(displayText(`Look at this.\n\n${CODE}`)).toBe(`Look at this.\n\n${CODE}`)
  })

  it('keeps prose on both sides of a mid-turn block', () => {
    const raw = `Start here.\n\n${CODE}\n\nNow why return early?`
    expect(displayText(raw)).toBe(raw)
  })

  it('keeps two separate code blocks', () => {
    const raw = `One.\n\n${CODE}\n\nTwo.\n\n${CODE}`
    expect(displayText(raw)).toBe(raw)
  })

  it('keeps a truncated code block, which is still readable', () => {
    expect(displayText('Here:\n\n```ts\nconst a = 1')).toBe('Here:\n\n```ts\nconst a = 1')
  })
})

describe('displayText — trailers never survive', () => {
  it('removes a drill-log trailer', () => {
    const out = displayText('Good session.\n\n```drill-log\nsolved: yes\nnote: n\n```')
    expect(out).toBe('Good session.')
    expect(out).not.toContain('solved')
  })

  it('removes a story-log trailer', () => {
    const out = displayText('Nice answer.\n\n```story-log\ncompetency: conflict\nstory: the migration\n```')
    expect(out).toBe('Nice answer.')
    expect(out).not.toContain('competency')
  })

  it('removes a truncated trailer and everything after it', () => {
    const out = displayText('Good session.\n\n```drill-log\nsolved: yes')
    expect(out).toBe('Good session.')
    expect(out).not.toContain('solved')
  })

  it('removes an unknown tag, because the allowlist defaults to hiding', () => {
    const out = displayText('Text.\n\n```verdict-log\nscore: 4\n```')
    expect(out).toBe('Text.')
    expect(out).not.toContain('score')
  })

  it('keeps the code and drops the trailer when a reply carries both', () => {
    const out = displayText(`Try this.\n\n${CODE}\n\n\`\`\`drill-log\nsolved: yes\nnote: n\n\`\`\``)
    expect(out).toContain('const a = 1')
    expect(out).not.toContain('solved')
  })
})

describe('displayText — replies with no fences', () => {
  it('returns plain prose unchanged but trimmed', () => {
    expect(displayText('  Just talking.  ')).toBe('Just talking.')
  })

  it('leaves inline backticks alone — only fences are blocks', () => {
    expect(displayText('Call `store.get(key)` first.')).toBe('Call `store.get(key)` first.')
  })
})

describe('speechText — no fenced block of any kind survives', () => {
  it('removes a code block', () => {
    expect(speechText(`Look at this.\n\n${CODE}`)).toBe('Look at this.\n\n')
  })

  it('removes a trailer', () => {
    expect(speechText('Done.\n\n```drill-log\nsolved: yes\n```')).toBe('Done.\n\n')
  })

  it('keeps the prose on both sides of a mid-turn code block', () => {
    expect(speechText(`Start here.\n\n${CODE}\n\nNow why?`)).toBe('Start here.\n\n\n\nNow why?')
  })

  it('truncates at an unterminated fence, since the tag is not yet known', () => {
    expect(speechText('Here:\n\n```ts\nconst a = 1')).toBe('Here:\n\n')
  })

  it('truncates at a backtick run that has no newline yet', () => {
    expect(speechText('Here:\n\n```t')).toBe('Here:\n\n')
  })

  it('leaves inline backticks alone', () => {
    expect(speechText('Call `store.get(key)` first.')).toBe('Call `store.get(key)` first.')
  })

  // The offsets the interviewer tracks are lengths into this string, so a stray
  // trim here would make it re-speak or skip text as the reply grows.
  it('does not trim, so offsets stay stable as the reply grows', () => {
    expect(speechText('  padded  ')).toBe('  padded  ')
  })

  // Delta by delta, the way the stream actually arrives: the prose before the
  // fence must never un-speak itself, and the prose after it must come back.
  it('never retracts spoken prose as a fence arrives character by character', () => {
    const full = `Start here.\n\n${CODE}\n\nNow why?`
    let previous = ''
    for (let i = 1; i <= full.length; i++) {
      const spoken = speechText(full.slice(0, i))
      // Growth is fine; shrinkage is only ever the trailing partial fence, which
      // the interviewer holds back and never emits.
      if (spoken.length < previous.length) {
        expect(previous.length - spoken.length).toBeLessThanOrEqual(3)
      }
      previous = spoken
    }
    expect(previous).toBe('Start here.\n\n\n\nNow why?')
  })
})

describe('hasCodeBlock', () => {
  it('is true for a code fence', () => {
    expect(hasCodeBlock(`Look.\n\n${CODE}`)).toBe(true)
  })

  it('is false for prose', () => {
    expect(hasCodeBlock('Just talking, with `inline` code.')).toBe(false)
  })

  it('is false for a reply carrying only a trailer', () => {
    expect(hasCodeBlock('Done.\n\n```drill-log\nsolved: yes\nnote: n\n```')).toBe(false)
  })

  it('finds a code block that follows a trailer-shaped one', () => {
    expect(hasCodeBlock(`\`\`\`story-log\na: b\n\`\`\`\n\n${CODE}`)).toBe(true)
  })
})
