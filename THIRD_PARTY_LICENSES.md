# Third-party licenses

Webdra is Apache-2.0. The dependencies below are permissive and compatible with that license. No non-free or unclear-license code is included. Ghidra (Apache-2.0) is not vendored.

## Capstone and Capstone.js

Disassembly uses `@alexaltea/capstone-js` 5.0.9, a BSD-3-Clause WebAssembly build of the Capstone engine. The wasm and JavaScript are copied into the site at build time and loaded from the same origin. Capstone itself is BSD-3-Clause, Copyright (c) 2013, COSEINC and contributors, developed by Nguyen Anh Quynh.

Capstone.js license:

```
BSD 3-Clause License

Copyright (c) 2017-2022, Alexandro Sanchez Bach
All rights reserved.

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice, this
   list of conditions and the following disclaimer.

2. Redistributions in binary form must reproduce the above copyright notice,
   this list of conditions and the following disclaimer in the documentation
   and/or other materials provided with the distribution.

3. Neither the name of the copyright holder nor the names of its
   contributors may be used to endorse or promote products derived from
   this software without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
```

## React

MIT License. Copyright (c) Meta Platforms, Inc. and affiliates.

## Vite, Vitest, Playwright, TypeScript

Build and test tools only. Vite and Vitest are MIT. Playwright and TypeScript are Apache-2.0. They are not shipped in the static site except for the small Vite client runtime, which is MIT.
