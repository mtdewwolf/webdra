.globl main
.globl _start
.text
main:
    mov w0, #42
    ret
_start:
    bl main
    mov w0, #0
    ret
.section .rodata
.globl msg
msg:
    .asciz "webdra-fixture-string"
