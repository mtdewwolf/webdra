#include <stdio.h>

static const char greeting[] = "webdra-fixture-string";

int helper(int value) {
    return value + 1;
}

int main(void) {
    puts(greeting);
    return helper(41);
}
