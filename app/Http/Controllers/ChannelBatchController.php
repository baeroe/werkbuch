<?php

namespace App\Http\Controllers;

use App\Http\Middleware\GuardChannelAuthorization;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Broadcast;
use Symfony\Component\HttpFoundation\InputBag;
use Symfony\Component\HttpKernel\Exception\AccessDeniedHttpException;

/**
 * `POST /broadcasting/batch` (A305): the live channels of a tab authorized in one request. Pusher asks for every channel
 * on its own, and a person who sees many projects joins one channel each: one `/broadcasting/auth` per channel held up
 * every other request of the page for seconds. The browser gathers the channels it asks for in one task
 * (`api/live.ts`) and sends them here; each is authorized exactly as `/broadcasting/auth` would (the same kinds of
 * channel as `GuardChannelAuthorization`, the same channel classes of routes/channels.php, the session of the interface
 * only, A283).
 *
 * Body `{socket_id, channel_names}` (a list of 1 to `MAX` names); anything else is a 403, like a refused channel.
 * Answer `{channels: {<name>: {auth, channel_data?} | {refused: true}}}`: a refusal of one channel refuses only it.
 */
final class ChannelBatchController extends Controller
{
    /** The most channels one request authorizes; the browser sends more in several. */
    public const MAX = 100;

    public function __invoke(Request $request): JsonResponse
    {
        $socket = $request->input('socket_id');
        $names = $request->input('channel_names');

        if (! GuardChannelAuthorization::allowsSocket($socket) || ! is_array($names) || ! array_is_list($names) || $names === [] || count($names) > self::MAX) {
            throw new AccessDeniedHttpException;
        }

        $channels = [];
        foreach ($names as $name) {
            if (! is_string($name)) {
                throw new AccessDeniedHttpException;
            }
            $channels[$name] = GuardChannelAuthorization::allowsChannel($name) ? $this->authorize($request, $socket, $name) : ['refused' => true];
        }

        return response()->json(['channels' => (object) $channels]);
    }

    /**
     * What `/broadcasting/auth` answers for the one channel: the broadcaster reads `channel_name` and `socket_id` from
     * the request, so it gets a copy of this one that names only that channel (the person stays the same).
     *
     * @return array<string, mixed>
     */
    private function authorize(Request $request, string $socket, string $name): array
    {
        $single = $request->duplicate();
        $single->setJson(new InputBag(['socket_id' => $socket, 'channel_name' => $name]));

        try {
            $answer = Broadcast::auth($single);
        } catch (AccessDeniedHttpException) {
            return ['refused' => true];
        }

        // only a broadcaster without Reverb answers nothing (the browser then never connects, A285)
        return is_array($answer) ? $answer : ['refused' => true];
    }
}
