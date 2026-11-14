.section __TEXT,__text
.globl _main
.globl _helper
_helper:
    movl $1, %eax
    addl %edi, %eax
    ret
_main:
    movl $42, %eax
    ret
.section __TEXT,__cstring
.asciz "webdra-fixture-string"
