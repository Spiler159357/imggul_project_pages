# Project Coding Rules

## Encoding

- All source files must be saved as UTF-8 without BOM.
- Never write files as "UTF-8 with BOM".
- Do not add a BOM marker to any file.
- Preserve existing file encoding unless explicitly asked otherwise.
- Before finishing a task, check that modified text files do not start with the UTF-8 BOM bytes EF BB BF.

## Deployment and Testing

- This project is deployed to the server through Cloudflare.
- Perform only simple syntax or static checks locally.
- Do not run direct end-to-end, browser, or live service tests locally unless explicitly requested by the user.
- Let the user commit and push the changes, then validate the actual behavior through the Cloudflare-deployed server.

## PowerShell File Reading

- On Windows PowerShell, always read text files with explicit UTF-8 decoding.
- Use `Get-Content -Encoding UTF8 <path>` instead of plain `Get-Content <path>`.
- When using `Select-String` on file contents that may contain Korean or other non-ASCII text, pipe from `Get-Content -Encoding UTF8`.
- Do not rely on Windows PowerShell's default encoding for UTF-8 files without BOM.