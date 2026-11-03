<?php

namespace App\Live;

/**
 * A broadcaster that can close the live connections of an account without Pusher's HTTP API (K4): the
 * RecordingBroadcaster of the tests. Broadcasts::terminate() asks Reverb (a PusherBroadcaster) directly.
 */
interface TerminatesUsers
{
    public function terminateUser(string $id): void;
}
