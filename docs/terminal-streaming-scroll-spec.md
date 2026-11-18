# Terminal scrolling during streaming output

## Problem and cause

In standalone PowerShell, a long generated answer can leave the terminal
viewport at older output and prevent normal scrolling toward the newest lines
until generation finishes. Bonfire rendered the entire growing reply in Ink's
live region. Once that region exceeds the terminal height, Ink clears the
terminal and replays accumulated static output on subsequent updates. Repeated
clears disrupt native scrollback navigation.

## Required behavior

- Native terminal scrolling remains owned by the terminal, not Bonfire.
- Never force a full-screen redraw because a streaming answer grows.
- Keep the live region strictly below the terminal's reported height.
- Long replies show a bounded live tail of the newest wrapped lines, with an
  explicit preview label. Short replies retain existing Markdown presentation.
- Keep all generated text in memory and write the complete formatted reply once
  into the static transcript on completion, tool boundaries, or cancellation.
- Do not change provider requests, session history, or model selection.
- Recalculate layout when the terminal is resized. Account for narrow terminals,
  long unbroken lines, and Unicode display widths rather than character counts.
- Reserve room for the spinner and input controls. Clip overflowing live
  content as a final safeguard instead of clearing the terminal.

## Scope and limitations

This addresses Bonfire's redraw behavior in normal scrollback mode; it does not
change Windows Terminal/console-host scroll settings or force auto-scroll while
the user is reviewing older output. The current reply's full earlier content
becomes available in formatted scrollback after the reply is committed.
Extremely small terminal windows may clip controls; enlarge the window to use
the complete interface. Shrinking below the height of the previous frame can
require Ink to perform one recovery redraw; subsequent streaming frames must
remain bounded, rather than repeatedly clearing the screen.

## Acceptance and tests

1. For many streaming updates at a fixed terminal size, including answers taller than the viewport,
   emitted terminal output contains no clear-screen or clear-scrollback escape.
2. The live answer shows the latest wrapped lines and stays within its budget.
3. The completed answer is emitted to static scrollback exactly once, intact.
4. Resize, narrow widths, Unicode, and long single-line answers remain bounded.
5. Existing command and model-picker tests continue to pass.

Implementation: `src/cli/App.tsx`,
`src/cli/components/StreamingMessage.tsx`, and `src/cli/hooks/useRows.ts`.
