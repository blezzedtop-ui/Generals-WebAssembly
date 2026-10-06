/*
**	Command & Conquer Generals Zero Hour(tm)
**	Copyright 2025 Electronic Arts Inc.
**
**	This program is free software: you can redistribute it and/or modify
**	it under the terms of the GNU General Public License as published by
**	the Free Software Foundation, either version 3 of the License, or
**	(at your option) any later version.
**
**	This program is distributed in the hope that it will be useful,
**	but WITHOUT ANY WARRANTY; without even the implied warranty of
**	MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
**	GNU General Public License for more details.
**
**	You should have received a copy of the GNU General Public License
**	along with this program.  If not, see <http://www.gnu.org/licenses/>.
*/

////////////////////////////////////////////////////////////////////////////////
//																																						//
//  (c) 2001-2003 Electronic Arts Inc.																				//
//																																						//
////////////////////////////////////////////////////////////////////////////////

// FILE: W3DGameClient.cpp /////////////////////////////////////////////////
//
// W3DImplementaion of the GameClient.  If there were a client/server
// architecture, this game interface could be thought of as the "client"
// that the user uses to interact with the logic of the game world which
// would be known as the "server"
//
// Author: Colin Day, April 2001
//
///////////////////////////////////////////////////////////////////////////////

// SYSTEM INCLUDES ////////////////////////////////////////////////////////////
#include <stdlib.h>
#ifdef __EMSCRIPTEN__
#include <emscripten/emscripten.h>
#endif

// USER INCLUDES //////////////////////////////////////////////////////////////

#include "Common/ThingTemplate.h"
#include "Common/ThingFactory.h"
#include "Common/ModuleFactory.h"
#include "Common/RandomValue.h"
#include "Common/GlobalData.h"
#include "Common/GameLOD.h"
#include "GameClient/Drawable.h"
#include "GameClient/GameClient.h"
#include "GameClient/ParticleSys.h"
#include "GameClient/RayEffect.h"
#include "W3DDevice/GameClient/W3DAssetManager.h"
#include "W3DDevice/GameClient/W3DGameClient.h"
#include "W3DDevice/GameClient/W3DStatusCircle.h"
#include "W3DDevice/GameClient/W3DScene.h"
#include "W3DDevice/GameClient/W3DShadow.h"
#include "W3DDevice/GameClient/HeightMap.h"
#include "WW3D2/part_emt.h"
#include "WW3D2/hanim.h"
#include "WW3D2/htree.h"
#include "WW3D2/animobj.h"  ///< @todo superhack for demo, remove!

#ifdef __EMSCRIPTEN__
namespace
{
// Safari has a much tighter practical memory ceiling than desktop browsers.
// Keep only *unused* texture cache under a conservative soft limit.  We never
// evict textures that have live references, so active terrain/models keep
// their graphics. Model prototypes are intentionally not hard-evicted while
// a map is running because that cache has no ownership-safe live eviction API.
constexpr unsigned long long WEB_BYTES_PER_MB = 1024ull * 1024ull;
constexpr unsigned long long WEB_UNUSED_TEXTURE_SOFT_LIMIT = 96ull * WEB_BYTES_PER_MB;
constexpr UnsignedInt WEB_CACHE_CHECK_FRAMES = 300;

unsigned long long webGetUnusedTextureBytes()
{
	WW3DAssetManager *assetManager = WW3DAssetManager::Get_Instance();
	if (assetManager == nullptr)
		return 0;

	unsigned long long unusedTextureBytes = 0;
	HashTemplateIterator<StringClass, TextureClass *> textureIt(assetManager->Texture_Hash());
	for (textureIt.First(); !textureIt.Is_Done(); textureIt.Next())
	{
		TextureClass *texture = textureIt.Peek_Value();
		if (texture != nullptr && texture->Num_Refs() <= 1)
			unusedTextureBytes += texture->Get_Texture_Memory_Usage();
	}

	return unusedTextureBytes;
}

void webReleaseUnusedAssets()
{
	WW3DAssetManager *assetManager = WW3DAssetManager::Get_Instance();
	if (assetManager != nullptr)
		assetManager->Release_Unused_Assets();
}

void webTrimUnusedAssetCache()
{
	if (webGetUnusedTextureBytes() > WEB_UNUSED_TEXTURE_SOFT_LIMIT)
		webReleaseUnusedAssets();
}
}

extern "C"
{
// JavaScript bridge for the mobile RAM controls.  Values are returned in MB
// so the ABI stays i32-friendly on wasm32 and Safari does not need BigInt.
EMSCRIPTEN_KEEPALIVE UnsignedInt gxWebGetUnusedTextureMB()
{
	return static_cast<UnsignedInt>(webGetUnusedTextureBytes() / WEB_BYTES_PER_MB);
}

EMSCRIPTEN_KEEPALIVE UnsignedInt gxWebReleaseUnusedAssets()
{
	const UnsignedInt unusedBefore = gxWebGetUnusedTextureMB();
	webReleaseUnusedAssets();
	return unusedBefore;
}
}
#endif

//-------------------------------------------------------------------------------------------------
//-------------------------------------------------------------------------------------------------
W3DGameClient::W3DGameClient()
{

}

//-------------------------------------------------------------------------------------------------
//-------------------------------------------------------------------------------------------------
W3DGameClient::~W3DGameClient()
{

}

//-------------------------------------------------------------------------------------------------
/** Initialize resources for the w3d game client */
//-------------------------------------------------------------------------------------------------
void W3DGameClient::init()
{

	// extending initialization routine
	GameClient::init();

}

//-------------------------------------------------------------------------------------------------
/** Per frame update, note we are extending functionality */
//-------------------------------------------------------------------------------------------------
void W3DGameClient::update()
{

	// call base
	GameClient::update();

#ifdef __EMSCRIPTEN__
	// Check infrequently to avoid per-frame cache-walk overhead.  The trim itself
	// is ref-count safe and only runs when unused texture memory exceeds the cap.
	static UnsignedInt webCacheCheckFrame = 0;
	if (++webCacheCheckFrame >= WEB_CACHE_CHECK_FRAMES)
	{
		webCacheCheckFrame = 0;
		webTrimUnusedAssetCache();
	}
#endif

}

//-------------------------------------------------------------------------------------------------
/** Reset this device client system.  Note we are extending reset functionality from
	* the device independent client */
//-------------------------------------------------------------------------------------------------
void W3DGameClient::reset()
{

	// Base reset destroys map drawables and resets display/terrain first.
	GameClient::reset();

#ifdef __EMSCRIPTEN__
	// Once map-owned drawables are gone, release only assets that no live object
	// references anymore.  This is deliberately not Free_Assets(): active/global
	// model prototypes are never blindly destroyed, preventing purple/missing art.
	webReleaseUnusedAssets();
#endif

}

//-------------------------------------------------------------------------------------------------
/** allocate a new drawable using the thing template for initialization.
	* if we want to have the thing manager actually contain the pools of
	* object and drawable storage it seems OK to have it be friends with the
	* GameLogic/Client for those purposes, or we could put the allocation pools
	* in the GameLogic and GameClient themselves */
//-------------------------------------------------------------------------------------------------
Drawable *W3DGameClient::friend_createDrawable( const ThingTemplate *tmplate,
																								DrawableStatusBits statusBits )
{
	Drawable *draw = nullptr;

	// sanity
	if( tmplate == nullptr )
		return nullptr;

	draw = newInstance(Drawable)( tmplate, statusBits );

	return draw;

}

//-------------------------------------------------------------------------------------------------
//-------------------------------------------------------------------------------------------------
void W3DGameClient::addScorch(const Coord3D *pos, Real radius, Scorches type)
{
	if (TheTerrainRenderObject)
	{
		Vector3 loc(pos->x, pos->y, pos->z);
		TheTerrainRenderObject->addScorch(loc, radius, type);
	}
}

//-------------------------------------------------------------------------------------------------
/** create an effect that requires a start and end location */
//-------------------------------------------------------------------------------------------------
void W3DGameClient::createRayEffectByTemplate( const Coord3D *start,
																		 const Coord3D *end,
																		 const ThingTemplate* tmpl )
{
	Drawable *draw = TheThingFactory->newDrawable(tmpl);

	if( draw )
	{
		Coord3D pos;

		// add to world, the location of the drawable is at the midpoint of laser
		pos.x = (end->x - start->x) * 0.5f + start->x;
		pos.y = (end->y - start->y) * 0.5f + start->y;
		pos.z = (end->z - start->z) * 0.5f + start->z;
		draw->setPosition( &pos );

		// add this ray effect to the list of ray effects
		TheRayEffects->addRayEffect( draw, start, end );

	}

}

//-------------------------------------------------------------------------------------------------
/**  Tell all the drawables what time of day it is now */
//-------------------------------------------------------------------------------------------------
void W3DGameClient::setTimeOfDay( TimeOfDay tod )
{

	GameClient::setTimeOfDay(tod);

	//tell cloud/water plane to update its lighting/texture
	if (TheWaterRenderObj)
		TheWaterRenderObj->setTimeOfDay(tod);
	if (TheW3DShadowManager)
		TheW3DShadowManager->setTimeOfDay(tod);

	//tell the display to update its lighting
	TheDisplay->setTimeOfDay( tod );

}


//-------------------------------------------------------------------------------------------------
//-------------------------------------------------------------------------------------------------
void W3DGameClient::setTeamColor(Int red, Int green, Int blue)
{

	W3DStatusCircle::setColor(red, green, blue);

}

//-------------------------------------------------------------------------------------------------
//-------------------------------------------------------------------------------------------------
void W3DGameClient::setTextureLOD( Int level )
{
	if (WW3D::Get_Texture_Reduction() != level)
	{
		WW3D::Set_Texture_Reduction(level, 32);

		if( TheTerrainRenderObject )
			TheTerrainRenderObject->setTextureLOD(level);
	}
}

//-------------------------------------------------------------------------------------------------
/**  Tell the terrain that an object moved, so it can knock down trees or crush grass
		or whatever is appropriate. jba. */
//-------------------------------------------------------------------------------------------------
void W3DGameClient::notifyTerrainObjectMoved(Object *obj)
{
	if (TheTerrainRenderObject) {
		TheTerrainRenderObject->unitMoved(obj);
	}

}

