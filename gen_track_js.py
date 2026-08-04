import json

with open('typhoon_track_cleaned.json', 'r', encoding='utf-8') as f:
    track = json.load(f)

# Generate JS array
lines = ['const typhoonTrack = [']
for pt in track:
    line = '    {"t":' + str(pt['t']) + \
           ',"lat":' + str(pt['lat']) + \
           ',"lon":' + str(pt['lon']) + \
           ',"psfc":' + str(pt['psfc']) + \
           ',"wind":' + str(pt['wind']) + '},'
    lines.append(line)
lines.append('];')

with open('typhoon_track_js.txt', 'w', encoding='utf-8') as f:
    f.write('\n'.join(lines))

print('Generated', len(lines), 'lines')
print('First:', lines[1])
print('Last:', lines[-2])
