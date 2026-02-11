import sys

with open('src/skills/drive/index.ts', 'r') as f:
    content = f.read()

search_text = """        } catch (e) {
          if ((e as NodeJS.ErrnoException).code === 'EXDEV') {
            await fs.promises.cp(src, dst, { recursive: true });
            await fs.promises.rm(src, { recursive: true });
            moved.push(`${name} -> ${folderName}/`);
          }
        }"""

replace_text = """        } catch (e) {
          if ((e as NodeJS.ErrnoException).code === 'EXDEV') {
            await fs.promises.cp(src, dst, { recursive: true });
            await fs.promises.rm(src, { recursive: true });
            moved.push(`${name} -> ${folderName}/`);
          } else {
            console.error(`[DriveSkill] Failed to move ${name}:`, e);
          }
        }"""

# It appears twice (once for date, once for extension)
new_content = content.replace(search_text, replace_text)

with open('src/skills/drive/index.ts', 'w') as f:
    f.write(new_content)
print("Updated error handling.")
