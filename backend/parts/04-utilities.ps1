# ------------------------------------------------------------------ utilities

$VK = @{}
for ($c = [int][char]'A'; $c -le [int][char]'Z'; $c++) { $VK[[string][char]$c] = $c }
for ($c = [int][char]'0'; $c -le [int][char]'9'; $c++) { $VK[[string][char]$c] = $c }
for ($i = 1; $i -le 24; $i++) { $VK["f$i"] = 0x6F + $i }
$VK['backspace'] = 0x08; $VK['tab'] = 0x09; $VK['enter'] = 0x0D; $VK['return'] = 0x0D
$VK['shift'] = 0x10; $VK['ctrl'] = 0x11; $VK['control'] = 0x11; $VK['alt'] = 0x12
$VK['pause'] = 0x13; $VK['capslock'] = 0x14; $VK['esc'] = 0x1B; $VK['escape'] = 0x1B
$VK['space'] = 0x20; $VK['pageup'] = 0x21; $VK['pagedown'] = 0x22; $VK['end'] = 0x23
$VK['home'] = 0x24; $VK['left'] = 0x25; $VK['up'] = 0x26; $VK['right'] = 0x27; $VK['down'] = 0x28
$VK['printscreen'] = 0x2C; $VK['insert'] = 0x2D; $VK['delete'] = 0x2E; $VK['del'] = 0x2E
$VK['win'] = 0x5B; $VK['lwin'] = 0x5B; $VK['meta'] = 0x5B; $VK['super'] = 0x5B; $VK['rwin'] = 0x5C
# Cross-platform spellings of the same modifiers. A model that learned "cmd+a" or
# "option+tab" elsewhere should not have to unlearn it here, so the aliases follow the
# obvious mapping (super/meta/command -> the Windows key, alt/option -> Alt, control
# -> Ctrl).
$VK['cmd'] = 0x5B; $VK['command'] = 0x5B; $VK['opt'] = 0x12; $VK['option'] = 0x12
$VK['numlock'] = 0x90; $VK['scrolllock'] = 0x91
$VK[';'] = 0xBA; $VK['='] = 0xBB; $VK[','] = 0xBC; $VK['-'] = 0xBD; $VK['.'] = 0xBE; $VK['/'] = 0xBF
$VK['`'] = 0xC0; $VK['['] = 0xDB; $VK['\'] = 0xDC; $VK[']'] = 0xDD; $VK["'"] = 0xDE

# Keys that must carry KEYEVENTF_EXTENDEDKEY or the target app sees the wrong key.
$EXTENDED = @(0x21, 0x22, 0x23, 0x24, 0x25, 0x26, 0x27, 0x28, 0x2C, 0x2D, 0x2E, 0x5B, 0x5C, 0x90)

