module atelier.example/lane

go 1.23.0

toolchain go1.23.4

require atelier.example/yamlish.v2 v0.0.0

require github.com/gorilla/mux v1.8.1

replace atelier.example/yamlish.v2 => ./third_party/yamlish.v2
