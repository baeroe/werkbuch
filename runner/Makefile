# The runner of werkbuch: build, test, install. The version is the version of werkbuch (spec 3).
BINDIR ?= $(HOME)/.local/bin
VERSION ?= dev
GO ?= go
LDFLAGS := -s -w -X main.version=$(VERSION)

.PHONY: build test vet fmt install clean

build:
	CGO_ENABLED=0 $(GO) build -trimpath -ldflags '$(LDFLAGS)' -o bin/werkbuch-runner .

test: vet
	$(GO) test -race -count=1 ./...

vet:
	@test -z "$$(gofmt -l .)" || (gofmt -l .; echo "gofmt needed"; exit 1)
	$(GO) vet ./...

fmt:
	gofmt -w .

install:
	mkdir -p $(BINDIR)
	CGO_ENABLED=0 $(GO) build -trimpath -ldflags '$(LDFLAGS)' -o $(BINDIR)/werkbuch-runner .

clean:
	rm -rf bin
