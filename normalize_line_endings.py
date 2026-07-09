with open('public/scripts/extensions/memory/index.js', 'rb') as f:
    data = f.read()

# Replace \r\r\n with \n, and \r\n with \n
normalized = data.replace(b'\r\r\n', b'\n').replace(b'\r\n', b'\n').replace(b'\r', b'\n')

# Convert back to standard \r\n for Windows if needed, or just \n
# Standard \n is perfectly fine for git and all editors
with open('public/scripts/extensions/memory/index.js', 'wb') as f:
    f.write(normalized)

print("Line endings normalized.")
