.section __TEXT,__text
.globl _main
_main:
    mov w0, #42
    ret
.section __TEXT,__cstring
.asciz "webdra-fixture-string"
