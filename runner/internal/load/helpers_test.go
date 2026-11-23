package load

import "github.com/baeroe/werkbuch/runner/internal/protocol"

func protocolLoad(cpu float64) protocol.Load { return protocol.Load{CPU: cpu} }
