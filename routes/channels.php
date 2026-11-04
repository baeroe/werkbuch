<?php

use App\Broadcasting\ProjectChannel;
use App\Broadcasting\UserChannel;
use App\Broadcasting\WorkItemChannel;
use Illuminate\Support\Facades\Broadcast;

// the live channels (spec 7.2, A280): /broadcasting/auth asks them for the session of the interface only (A283), and
// they decide through the policies and Visibility; a parameter never names a global route binding ({project}, {item})
Broadcast::channel('project.{projectId}', ProjectChannel::class);
Broadcast::channel('work-item.{itemId}', WorkItemChannel::class);
Broadcast::channel('user.{userId}', UserChannel::class);
