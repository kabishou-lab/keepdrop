# Map a Chat Completions-style {messages: [...]} dump into keepdrop's transcript.
# Usage:
#   jq -f examples/from-openai-messages.jq session.json > transcript.json
#
# Pi / Claude Code: first get to an array of {role, content, tool_calls?, tool_call_id?}.
# This file does not read those vendors' session files directly.

{
  goal: (.goal // .instruction // ""),
  messages: [
    (.messages // .)[]
    | {
        role,
        content: (.content // ""),
        tool_call_id: .tool_call_id,
        name: .name,
        tool_calls: (
          (.tool_calls // [])
          | map({
              id: (.id // .tool_call_id),
              name: (.function.name // .name),
              arguments: (.function.arguments // .arguments // "")
            })
        )
      }
    | if (.tool_calls | length) == 0 then del(.tool_calls) else . end
    | if .tool_call_id == null then del(.tool_call_id) else . end
    | if .name == null then del(.name) else . end
  ]
}
