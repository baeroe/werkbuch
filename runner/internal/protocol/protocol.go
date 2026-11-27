// Package protocol holds the shapes of the runner protocol under /api/runner (spec 6, werkbuch's RunnerProtocolController
// and its actions, A472–A487). Field names are the JSON keys werkbuch reads and writes.
package protocol

import "time"

// Version is the protocol the runner speaks (`X-Werkbuch-Protocol`, App\Domain\Agents\Protocol::VERSION).
const Version = 1

// Kinds of run (spec 7.1).
const (
	Task       = "task"
	Correction = "correction"
	Conflict   = "conflict"
	Review     = "review"
	Comment    = "comment"
)

// Statuses a runner may end a run with (RunStatus::REPORTED).
const (
	Succeeded = "succeeded"
	Failed    = "failed"
	Canceled  = "canceled"
	TimedOut  = "timed_out"
)

// Event kinds werkbuch keeps (AgentRunEvent::KINDS).
const (
	KindSystem = "system"
	KindText   = "text"
	KindTool   = "tool"
	KindResult = "result"
	KindError  = "error"
)

// Limits of werkbuch (Protocol::EVENTS_PER_BATCH, EVENT_TEXT_MAX, FinishRun).
const (
	EventsPerBatch = 100
	EventTextMax   = 4000
	TextMax        = 65535
	SummaryMax     = 2000
	ErrorMax       = 500
)

// Light runs only read and use a pot of places of their own (spec 9).
func Light(kind string) bool { return kind == Review || kind == Comment }

// Codes says whether a run changes code (it gets a branch and reports a commit).
func Codes(kind string) bool { return kind == Task || kind == Correction || kind == Conflict }

// Load is the utilization of the machine (spec 8.6): CPU and GPU in percent (GPU nil without a reading), RAM and disk
// in GB.
type Load struct {
	CPU       float64  `json:"cpu"`
	GPU       *float64 `json:"gpu"`
	RAMUsed   float64  `json:"ram_used"`
	RAMTotal  float64  `json:"ram_total"`
	DiskFree  float64  `json:"disk_free"`
	DiskTotal float64  `json:"disk_total"`
}

// CLI is what the runner knows of an agent CLI (spec 8.8).
type CLI struct {
	CLI       string  `json:"cli"`
	Installed bool    `json:"installed"`
	Version   *string `json:"version"`
	LoggedIn  bool    `json:"logged_in"`
	Path      *string `json:"path"`
}

// Equipment is what the harness of the machine brings (spec 8.7), as names.
type Equipment struct {
	MCPServers     []string `json:"mcp_servers"`
	Skills         []string `json:"skills"`
	Plugins        []string `json:"plugins"`
	WerkbuchAccess []string `json:"werkbuch_access"`
}

// UsageWindow is one window of the Claude subscription: used in percent and when it resets (RFC 3339, nil unknown).
type UsageWindow struct {
	Percent  float64 `json:"percent"`
	ResetsAt *string `json:"resets_at"`
}

// Subscription is how much of the Claude subscription is used (WEBU-65): the session (five hours) and the week, each
// nil when unknown. An empty one says nothing is known.
type Subscription struct {
	Session *UsageWindow `json:"session"`
	Week    *UsageWindow `json:"week"`
}

// Report goes with every claim and heartbeat; a part left out keeps werkbuch's last one.
type Report struct {
	Load      *Load         `json:"load,omitempty"`
	CLIs      []CLI         `json:"clis,omitempty"`
	Equipment *Equipment    `json:"equipment,omitempty"`
	Usage     *Subscription `json:"usage,omitempty"`
}

// Places are the places of the runner as set in werkbuch and as used now (spec 9).
type Places struct {
	Total   int `json:"total"`
	PerRepo int `json:"per_repo"`
	Light   int `json:"light"`
	Used    struct {
		Total   int `json:"total"`
		PerRepo int `json:"per_repo"`
		Light   int `json:"light"`
	} `json:"used"`
}

// Answer is what every answer carries.
type Answer struct {
	Places           Places `json:"places"`
	Version          string `json:"version"`
	Protocol         int    `json:"protocol"`
	HeartbeatSeconds int    `json:"heartbeat_seconds"`
}

// PairRequest redeems a one-time code (`POST pair`).
type PairRequest struct {
	Code    string `json:"code"`
	Name    string `json:"name"`
	OS      string `json:"os"`
	Arch    string `json:"arch"`
	Version string `json:"version"`
}

// PairAnswer carries the token once.
type PairAnswer struct {
	Answer
	Runner struct {
		ID   string `json:"id"`
		Name string `json:"name"`
	} `json:"runner"`
	Token string `json:"token"`
}

// ProjectRef names the project of a run.
type ProjectRef struct {
	ID         string `json:"id"`
	Identifier string `json:"identifier"`
}

// ItemRef names the item of a run.
type ItemRef struct {
	ID    string `json:"id"`
	Key   string `json:"key"`
	Title string `json:"title"`
}

// Thread is the strand of a run (spec 5): branch, base, worktree name and the session to resume.
type Thread struct {
	ID         string  `json:"id"`
	Branch     *string `json:"branch"`
	BaseBranch *string `json:"base_branch"`
	Worktree   *string `json:"worktree"`
	SessionID  *string `json:"session_id"`
}

// Identity is the commit identity of the bot.
type Identity struct {
	Name  string `json:"name"`
	Email string `json:"email"`
}

// MCP is the way of the agent to werkbuch: the server `werkbuch-run` with the run token.
type MCP struct {
	MCPURL     string `json:"mcp_url"`
	ServerName string `json:"server_name"`
	Token      string `json:"token"`
}

// Git is the repository and installation token (spec 6.3, 11.3), null until WEBU-24 and for projects without one.
type Git struct {
	RepoURL   string     `json:"repo_url"`
	Token     string     `json:"token"`
	ExpiresAt *time.Time `json:"expires_at"`
}

// Run is what a claim hands the runner (ClaimRun::payload).
type Run struct {
	ID              string     `json:"id"`
	Attempt         int        `json:"attempt"`
	Type            string     `json:"type"`
	CLI             string     `json:"cli"`
	Model           string     `json:"model"`
	ModelSource     string     `json:"model_source"`
	TimeoutMinutes  int        `json:"timeout_minutes"`
	DeadlineAt      *time.Time `json:"deadline_at"`
	LeaseExpiresAt  *time.Time `json:"lease_expires_at"`
	Project         ProjectRef `json:"project"`
	Item            *ItemRef   `json:"item"`
	Thread          *Thread    `json:"thread"`
	HeadSHA         *string    `json:"head_sha"`
	SetupCommand    *string    `json:"setup_command"`
	TeardownCommand *string    `json:"teardown_command"`
	StopCommand     *string    `json:"stop_command"`
	CommitIdentity  Identity   `json:"commit_identity"`
	SystemPrompt    string     `json:"system_prompt"`
	Prompt          string     `json:"prompt"`
	Werkbuch        MCP        `json:"werkbuch"`
	Git             *Git       `json:"git"`
}

// Deadline is when the time limit ends: werkbuch's `deadline_at`, else start plus the limit.
func (r Run) Deadline(started time.Time) time.Time {
	if r.DeadlineAt != nil {
		return *r.DeadlineAt
	}
	minutes := r.TimeoutMinutes
	if minutes <= 0 {
		minutes = 120
	}
	return started.Add(time.Duration(minutes) * time.Minute)
}

// SessionID is the session of the strand to resume, empty for a fresh one (spec 7.8: a review never resumes).
func (r Run) SessionID() string {
	if r.Type == Review || r.Thread == nil || r.Thread.SessionID == nil {
		return ""
	}
	return *r.Thread.SessionID
}

// ClaimAnswer is the answer of `POST claim`; Run nil without work.
type ClaimAnswer struct {
	Answer
	Run *Run `json:"run"`
	// ClosedThreads are worktree names of strands that ended on this runner: the runner removes them at once (WEBU-61)
	ClosedThreads []string `json:"closed_threads"`
}

// HeartbeatAnswer says whether the run was canceled and when lease and limit end.
type HeartbeatAnswer struct {
	Answer
	Cancel         bool       `json:"cancel"`
	LeaseExpiresAt *time.Time `json:"lease_expires_at"`
	DeadlineAt     *time.Time `json:"deadline_at"`
}

// GitTokenAnswer is the answer of `POST runs/{id}/git-token`: a new installation token for the run (WEBU-31).
type GitTokenAnswer struct {
	Answer
	Git Git `json:"git"`
}

// Event is a line of the log of a run.
type Event struct {
	Kind string    `json:"kind"`
	Text string    `json:"text"`
	At   time.Time `json:"at"`
}

// Usage is what the CLI reports it spent.
type Usage struct {
	Input  int `json:"input"`
	Output int `json:"output"`
}

// Result ends a run (`POST runs/{id}/result`).
type Result struct {
	Attempt   int     `json:"attempt"`
	Status    string  `json:"status"`
	SessionID *string `json:"session_id,omitempty"`
	Verdict   *string `json:"verdict,omitempty"`
	Outcome   *string `json:"outcome,omitempty"`
	Text      *string `json:"text,omitempty"`
	Commit    *string `json:"commit,omitempty"`
	Summary   *string `json:"summary,omitempty"`
	Usage     *Usage  `json:"usage,omitempty"`
	Error     *string `json:"error,omitempty"`
}
